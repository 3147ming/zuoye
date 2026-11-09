import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Input } from '../core/input';
import { Sfx } from '../core/audio';
import { UI, type Snapshot } from '../ui/ui';
import type { ChestDef, ItemId, NpcDef, PortalDef, RegionId } from '../types';
import { buildRegion } from '../data/regions';
import { ITEMS, RECIPES, SHOP_GOODS } from '../data/items';
import { BOSS_INTRO, ENDING_LINES, getNpcDialog, type DialogLine } from '../data/dialogs';
import { angleDiff, angleTo, clamp, dist, randInt, randRange, TAU } from '../core/utils';
import { World3D, type RuntimeChest, type RuntimeNode } from './world3d';
import { Fx3D } from './fx3d';
import { Player3D } from './player3d';
import { Enemy3D, Projectile3D } from './enemies3d';
import { Boss3D } from './boss3d';
import type { Game3DRef, PickupSpec } from './api3d';
import { S, createPickupModel, disposeObject } from './models';

type Mode = 'title' | 'playing' | 'dead' | 'victory';

interface Pickup {
  x: number;
  y: number;
  vx: number;
  vy: number;
  item?: ItemId;
  money?: number;
  count: number;
  life: number;
  t: number;
  group: THREE.Group;
}

type Interactable =
  | { kind: 'npc'; npc: NpcDef; d: number }
  | { kind: 'portal'; portal: PortalDef; d: number }
  | { kind: 'node'; node: RuntimeNode; d: number }
  | { kind: 'chest'; chest: RuntimeChest; d: number }
  | { kind: 'shrine'; x: number; y: number; d: number };

export class Game3D implements Game3DRef {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;

  ui: UI;
  input: Input;
  audio = new Sfx();
  fx!: Fx3D;

  world!: World3D;
  region = buildRegion('town');
  player = new Player3D(1060, 1020);
  enemies: Enemy3D[] = [];
  boss: Boss3D | null = null;
  projectiles: Projectile3D[] = [];
  pickups: Pickup[] = [];
  flags = new Set<string>();

  mode: Mode = 'title';
  time = 0;
  private last = 0;
  private elapsed = 0;
  private slowT = 0;
  private slowScale = 1;
  private flashAlpha = 0;
  private flashColor = '#ffffff';
  private shakeAmp = 0;
  private punch = 0;
  private victoryDelay = 0;
  private bossTriggered = false;
  private promptTarget: Interactable | null = null;
  private ambientT = 0;

  private openedChests = new Set<string>();
  private goneNodes = new Set<string>();
  private kills = { wolf: 0, ghost: 0, monk: 0, total: 0 };
  private perfectDodges = 0;
  private spawnPoint: { region: RegionId; x: number; y: number } = { region: 'town', x: 1060, y: 1020 };

  private yaw = -Math.PI / 2;
  private pitch = 0.42;
  private camDist = 9.6;
  private camTarget = new THREE.Vector3();
  private dragging = false;
  private locked = false;

  private flashEl: HTMLElement;
  private crosshair: HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = this.createRenderer(canvas);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;

    this.camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.1, 240);
    this.camera.position.set(0, 10, 10);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.region ? new THREE.Scene() : new THREE.Scene(), this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.58, 0.55, 0.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.flashEl = document.getElementById('flash3d')!;
    this.crosshair = document.getElementById('crosshair')!;

    this.input = new Input(canvas);

    this.ui = new UI(document.getElementById('ui')!, {
      onStart: () => this.startRun(),
      onRespawn: () => this.respawn(),
      onRestart: () => {
        this.ui.hideVictory();
        this.startRun();
      },
      onTitle: () => this.toTitle(),
      onUseItem: (id) => {
        this.useItem(id);
        this.ui.refreshPanel(this.snapshot());
      },
      onBuy: (id) => this.buy(id),
      onCraft: (i) => this.craft(i),
      onClosePanel: () => {
        this.ui.setPrompt(null);
        this.input.mouse.down = false;
        this.requestLock();
      },
      onResume: () => {
        this.audio.ui();
        this.input.mouse.down = false;
        this.requestLock();
      },
      onDialogueEnd: () => {
        this.input.pressed.clear();
        this.input.mouse.clicked = false;
        this.requestLock();
      },
    });

    this.loadRegion('town', 1060, 1020, false);
    this.bindCameraControls();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onGlobalKey(e));

    this.requestFrame();
  }

  /* ------------------------------ 生命周期 ------------------------------ */
  private createRenderer(canvas: HTMLCanvasElement) {
    try {
      return new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      console.warn('[烬影·墨刃] 高性能 WebGL 初始化失败，尝试兼容模式', err);
      try {
        return new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'default', stencil: false });
      } catch {
        throw new Error('当前环境无法创建 WebGL 上下文。请开启浏览器硬件加速，或使用 Chrome / Edge 打开。');
      }
    }
  }

  private startRun() {
    this.audio.init();
    this.audio.startDrone();
    this.flags.clear();
    this.openedChests.clear();
    this.goneNodes.clear();
    this.kills = { wolf: 0, ghost: 0, monk: 0, total: 0 };
    this.perfectDodges = 0;
    this.player = new Player3D(1060, 1020);
    this.player.money = 80;
    this.player.inv.add('pill_heal', 3);
    this.player.inv.add('pill_chi', 1);
    this.mode = 'playing';
    this.elapsed = 0;
    this.slowT = 0;
    this.flashAlpha = 0;
    this.spawnPoint = { region: 'town', x: 1060, y: 1020 };
    this.ui.showHUD();
    this.loadRegion('town', 1060, 1020, true);
    this.ui.setMoney(this.player.money);
    this.ui.toast('点击画面锁定视角 · WASD 移动 · 左键挥刀 · 1/2/3 武学');
    this.updateObjective();
    this.openDialogue(
      [
        { speaker: '旁白', text: '三日前，烬门在一场红雨里灭了。' },
        { speaker: '旁白', text: '师父把刀塞进你手里，只说了最后一句话——「别相信脸」。' },
        { speaker: '旁白', text: '你追着凶手的痕迹，来到青石镇。' },
      ],
      () => this.ui.toast('去找镇中的说书人问问吧'),
    );
  }

  private toTitle() {
    this.mode = 'title';
    this.ui.hideDeath();
    this.ui.hideVictory();
    this.ui.showTitle();
    this.audio.setRegionMood(0);
    this.input.mouse.down = false;
    document.exitPointerLock?.();
    this.loadRegion('town', 1060, 1020, false);
  }

  private respawn() {
    const loss = Math.floor(this.player.money * 0.2);
    this.player.money -= loss;
    const sp = this.spawnPoint;
    this.player.reset(sp.x, sp.y);
    this.mode = 'playing';
    this.slowT = 0;
    this.flashAlpha = 0;
    this.ui.hideDeath();
    this.ui.showHUD();
    this.loadRegion(sp.region, sp.x, sp.y, true);
    if (loss > 0) this.ui.toast(`散落铜钱 ${loss} 文`);
    this.ui.setMoney(this.player.money);
    this.snapCamera();
    this.requestLock();
  }

  private loadRegion(id: RegionId, x: number, y: number, announce: boolean) {
    if (this.world) {
      this.fx?.dispose();
      this.world.scene.remove(this.player.model.group);
      this.world.dispose();
    }
    this.enemies = [];
    this.boss = null;
    this.projectiles = [];
    this.pickups = [];
    this.bossTriggered = false;
    this.victoryDelay = 0;
    this.promptTarget = null;
    this.ui.setPrompt(null);
    this.ui.hideBoss();

    this.region = buildRegion(id);
    this.world = new World3D(this.region, this.openedChests, this.goneNodes);
    this.renderPass.scene = this.world.scene;
    this.fx = new Fx3D(this.world.scene);

    this.player.x = x;
    this.player.y = y;
    this.player.kbx = 0;
    this.player.kby = 0;
    this.player.dodgeT = 0;
    this.player.dashT = 0;
    this.player.channel = 0;
    this.player.bladeT = 0;
    this.player.invuln = Math.max(this.player.invuln, 0.6);
    this.player.dead = false;
    this.player.model.spin.rotation.z = 0;
    this.player.model.spin.position.y = 0;
    this.world.scene.add(this.player.model.group);

    for (const spawn of this.region.spawns) {
      if (spawn.key && this.flags.has(spawn.key)) continue;
      for (let i = 0; i < spawn.count; i++) {
        const ox = spawn.count === 1 ? 0 : randRange(-spawn.radius, spawn.radius);
        const oy = spawn.count === 1 ? 0 : randRange(-spawn.radius, spawn.radius);
        const pos = this.world.collide(spawn.x + ox, spawn.y + oy, 16);
        this.spawnEnemy(spawn.kind as 'wolf' | 'ghost' | 'monk', pos.x, pos.y, spawn.elite, spawn.name, spawn.key);
      }
    }

    this.refreshPortals();
    const centerX = this.region.w / 2;
    const centerY = this.region.h / 2;
    this.yaw = angleTo(x, y, centerX, centerY);
    this.pitch = 0.42;
    this.snapCamera();
    this.ui.setRegion(this.region.name);
    this.audio.setRegionMood(['town', 'forest', 'temple', 'cliff'].indexOf(this.region.id));
    this.updateObjective();
    if (announce) {
      const subs: Record<RegionId, string> = {
        town: '红雨之后，你回来了',
        forest: '枯木成林，狼嚎不止',
        temple: '佛前残灯，照不亮所有角落',
        cliff: '风很冷，像刀',
      };
      this.ui.banner(this.region.name, subs[this.region.id]);
    }
  }

  private refreshPortals() {
    for (const p of this.world.portals) {
      const unlocked = !p.def.need || this.flags.has(p.def.need);
      this.world.setPortalUnlocked(p.def, unlocked);
    }
  }

  private snapCamera() {
    this.camTarget.set(this.player.x * S, 1.15, this.player.y * S);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /* ------------------------------ 相机与输入 ------------------------------ */
  private bindCameraControls() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        this.dragging = true;
        return;
      }
      if (e.button !== 0) return;
      if (this.mode !== 'playing' || this.ui.isOpen()) return;
      if (document.pointerLockElement !== this.canvas) this.requestLock();
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.mode !== 'playing' || this.ui.isOpen()) return;
      if (!this.locked && !this.dragging) return;
      this.yaw += e.movementX * 0.0026;
      this.pitch = clamp(this.pitch - e.movementY * 0.0019, 0.07, 1.05);
    });
    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      this.crosshair.classList.toggle('on', this.locked && this.mode === 'playing');
      if (wasLocked && !this.locked && this.mode === 'playing' && !this.ui.isOpen()) {
        this.audio.ui();
        this.input.mouse.down = false;
        this.ui.setPrompt(null);
        this.ui.openPause();
      }
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this.crosshair.classList.remove('on');
    });
    this.canvas.addEventListener('wheel', (e) => {
      if (this.mode !== 'playing' || this.ui.isOpen()) return;
      this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 0.8, 5.5, 16);
    }, { passive: true });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private requestLock() {
    if (this.mode !== 'playing' || this.ui.isOpen()) return;
    if (document.pointerLockElement === this.canvas) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => {});
      }
    } catch {
      /* 浏览器拒绝锁定，可直接右键拖动转视角 */
    }
  }

  private onGlobalKey(e: KeyboardEvent) {
    if (this.mode !== 'playing' || this.ui.isDialogueOpen()) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      if (this.ui.isPanelOpen()) {
        this.ui.closePanel();
        this.requestLock();
      } else {
        this.audio.ui();
        this.input.mouse.down = false;
        this.ui.setPrompt(null);
        document.exitPointerLock?.();
        this.ui.openInventory(this.snapshot());
      }
    } else if (e.code === 'Escape') {
      e.preventDefault();
      if (this.ui.isPanelOpen()) {
        this.ui.closePanel();
        this.requestLock();
      } else {
        this.audio.ui();
        this.input.mouse.down = false;
        this.ui.setPrompt(null);
        document.exitPointerLock?.();
        this.ui.openPause();
      }
    } else if (e.code === 'KeyH') {
      if (this.ui.isPanelOpen()) {
        this.ui.closePanel();
        this.requestLock();
      } else {
        this.audio.ui();
        this.ui.setPrompt(null);
        document.exitPointerLock?.();
        this.ui.openHelp();
      }
    } else if (e.code === 'KeyM') {
      this.audio.setMuted(!this.audio.muted);
      this.ui.toast(this.audio.muted ? '已静音' : '已恢复声音');
    }
  }

  private openDialogue(
    lines: DialogLine[],
    done: () => void,
  ) {
    this.input.mouse.down = false;
    this.ui.setPrompt(null);
    document.exitPointerLock?.();
    this.ui.showDialogue(lines, () => {
      this.input.pressed.clear();
      this.input.mouse.clicked = false;
      done();
      this.requestLock();
    });
  }

  /* ------------------------------ 主循环 ------------------------------ */
  private requestFrame() {
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    const rawDt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    this.time += rawDt;

    if (this.mode === 'playing' && !this.ui.isOpen()) {
      if (this.victoryDelay > 0) {
        this.victoryDelay -= rawDt;
        if (this.victoryDelay <= 0) this.showVictory();
      }
      const dt = rawDt * (this.slowT > 0 ? this.slowScale : 1);
      if (this.slowT > 0) this.slowT -= rawDt;
      this.update(dt, rawDt);
      this.elapsed += rawDt;
    }

    if (this.fx) this.fx.update(rawDt);
    if (this.world) this.world.update(rawDt);
    this.flashAlpha = Math.max(0, this.flashAlpha - rawDt * 2.6);
    this.flashEl.style.opacity = String(Math.min(1, this.flashAlpha));
    this.updateCamera(rawDt);

    if (this.crosshair) {
      this.crosshair.classList.toggle('on', this.locked && this.mode === 'playing' && !this.ui.isOpen());
    }

    this.composer.render();
    this.input.endFrame();
    requestAnimationFrame(this.frame);
  };

  private update(dt: number, rawDt: number) {
    const ix = this.input.moveX;
    const iy = this.input.moveY;
    const fwdX = Math.cos(this.yaw);
    const fwdZ = Math.sin(this.yaw);
    const rightX = -Math.sin(this.yaw);
    const rightZ = Math.cos(this.yaw);
    let mx = fwdX * -iy + rightX * ix;
    let mz = fwdZ * -iy + rightZ * ix;
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
    }

    this.player.update(dt, { x: mx, y: mz, len: Math.min(1, len) }, this.yaw, this);

    for (const e of this.enemies) e.update(dt, this);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) {
        this.enemies[i].dispose();
        this.enemies.splice(i, 1);
      }
    }

    if (this.boss) {
      if (!this.boss.dead) this.boss.update(dt, this);
    }

    for (const p of this.projectiles) p.update(dt, this);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].dead) {
        this.projectiles[i].dispose();
        this.projectiles.splice(i, 1);
      }
    }

    this.updatePickups(dt);
    this.spawnAmbient(rawDt);

    if (this.region.boss && !this.bossTriggered && !this.flags.has('boss_dead') && this.player.x > this.region.boss.triggerX) {
      this.triggerBoss();
    }

    this.promptTarget = this.findInteractable();
    if (this.promptTarget) {
      this.ui.setPrompt(this.promptText(this.promptTarget));
      if (this.input.wasPressed('KeyE')) this.interact(this.promptTarget);
    } else {
      this.ui.setPrompt(null);
    }

    if (this.input.wasPressed('KeyQ')) this.useItem('pill_heal');
    if (this.input.wasPressed('KeyR')) this.useItem('pill_chi');

    this.syncHud();
    if (this.boss && !this.boss.dead) {
      this.ui.showBoss('无面', this.boss.hp, this.boss.maxHp, this.boss.phase);
    } else {
      this.ui.hideBoss();
    }
  }

  private updateCamera(rawDt: number) {
    if (this.mode === 'title' || !this.world) {
      const cx = (this.region.w * S) / 2;
      const cz = (this.region.h * S) / 2;
      const ang = this.time * 0.07 + 0.7;
      const rad = 22;
      this.camera.position.set(cx + Math.cos(ang) * rad, 11.5, cz + Math.sin(ang) * rad);
      this.camera.lookAt(cx, 1.2, cz);
      return;
    }

    this.camTarget.lerp(new THREE.Vector3(this.player.x * S, 1.15, this.player.y * S), 1 - Math.exp(-9 * rawDt));
    this.shakeAmp *= Math.exp(-rawDt * 7);
    this.punch *= Math.exp(-rawDt * 6);

    const d = this.camDist - this.punch * 0.055;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const fx = Math.cos(this.yaw);
    const fz = Math.sin(this.yaw);
    // 镜头避障：若与房屋/树木等实体相交，则拉近镜头，避免画面被黑影糊住
    let dd = d;
    const steps = 18;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const wx = this.camTarget.x - fx * cp * d * t;
      const wz = this.camTarget.z - fz * cp * d * t;
      if (this.world.pointBlocked(wx / S, wz / S)) {
        dd = Math.max(3.1, (d * (i - 1)) / steps - 0.3);
        break;
      }
    }
    const pos = new THREE.Vector3(
      this.camTarget.x - fx * cp * dd,
      this.camTarget.y + sp * dd,
      this.camTarget.z - fz * cp * dd,
    );
    pos.x = clamp(pos.x, 0.4, (this.region.w * S) - 0.4);
    pos.z = clamp(pos.z, 0.4, (this.region.h * S) - 0.4);
    pos.y = Math.max(pos.y, 0.9);
    if (this.shakeAmp > 0.01) {
      const s = this.shakeAmp * 0.02;
      pos.x += (Math.random() - 0.5) * s;
      pos.y += (Math.random() - 0.5) * s;
      pos.z += (Math.random() - 0.5) * s;
    }
    this.camera.position.copy(pos);
    const look = new THREE.Vector3(
      this.camTarget.x + fx * 2.2,
      this.camTarget.y + 0.15,
      this.camTarget.z + fz * 2.2,
    );
    if (this.shakeAmp > 0.01) {
      look.x += (Math.random() - 0.5) * this.shakeAmp * 0.012;
      look.y += (Math.random() - 0.5) * this.shakeAmp * 0.012;
    }
    this.camera.lookAt(look);
  }

  /* ------------------------------ 交互 ------------------------------ */
  private findInteractable(): Interactable | null {
    const px = this.player.x;
    const py = this.player.y;
    let best: Interactable | null = null;
    const consider = (item: Interactable) => {
      if (!best || item.d < best.d) best = item;
    };
    for (const npc of this.region.npcs) {
      const d = dist(px, py, npc.x, npc.y);
      if (d < 96) consider({ kind: 'npc', npc, d });
    }
    for (const portal of this.region.portals) {
      const d = dist(px, py, portal.x, portal.y);
      if (d < 130) consider({ kind: 'portal', portal, d });
    }
    for (const node of this.world.nodes) {
      if (!node.alive) continue;
      const d = dist(px, py, node.def.x, node.def.y);
      if (d < 84) consider({ kind: 'node', node, d });
    }
    for (const chest of this.world.chests) {
      if (chest.opened) continue;
      const d = dist(px, py, chest.def.x, chest.def.y);
      if (d < 86) consider({ kind: 'chest', chest, d });
    }
    if (this.region.shrine) {
      const d = dist(px, py, this.region.shrine.x, this.region.shrine.y);
      if (d < 96) consider({ kind: 'shrine', x: this.region.shrine.x, y: this.region.shrine.y, d });
    }
    return best;
  }

  private promptText(t: Interactable): string {
    switch (t.kind) {
      case 'npc':
        return `交谈 · ${t.npc.name}`;
      case 'portal': {
        const unlocked = !t.portal.need || this.flags.has(t.portal.need);
        return unlocked ? `前往 ${t.portal.label}` : `${t.portal.label} · 封闭`;
      }
      case 'node':
        return `采集 ${ITEMS[t.node.def.item].name}`;
      case 'chest':
        return '开启木箱';
      case 'shrine':
        return '调息 · 记录重生点';
    }
  }

  private interact(t: Interactable) {
    if (t.kind === 'npc') {
      this.openNpc(t.npc);
      return;
    }
    if (t.kind === 'portal') {
      if (t.portal.need && !this.flags.has(t.portal.need)) {
        this.ui.toast(t.portal.hint ?? '此路不通');
        this.audio.deny();
        return;
      }
      this.audio.gate();
      this.ui.setPrompt(null);
      this.input.mouse.down = false;
      this.ui.fade(() => this.loadRegion(t.portal.to, t.portal.tx, t.portal.ty, true));
      return;
    }
    if (t.kind === 'node') {
      const def = t.node.def;
      t.node.alive = false;
      t.node.timer = 45;
      this.world.setNodeVisible(t.node, false);
      this.goneNodes.add(def.id);
      this.player.inv.add(def.item, def.count);
      this.audio.pickup();
      this.ui.toast(`获得 ${ITEMS[def.item].name} ×${def.count}`);
      this.fx.burst(def.x, def.y - 10, {
        count: 20,
        color: def.item === 'ghostfire' ? '#63e8d6' : '#7ad08e',
        color2: '#e8ffdc',
        speed: 110,
        size: 2.6,
        life: 0.8,
        grav: -40,
      });
      window.setTimeout(() => this.goneNodes.delete(def.id), 45000);
      return;
    }
    if (t.kind === 'chest') {
      const c = t.chest;
      c.opened = true;
      this.world.openChest(c);
      this.openedChests.add(c.def.id);
      if (c.def.money) this.player.money += c.def.money;
      if (c.def.item) this.player.inv.add(c.def.item, c.def.count ?? 1);
      this.audio.buy();
      const parts: string[] = [];
      if (c.def.money) parts.push(`${c.def.money} 文`);
      if (c.def.item) parts.push(`${ITEMS[c.def.item].name} ×${c.def.count ?? 1}`);
      this.ui.toast(`开箱：${parts.join(' · ')}`);
      this.fx.burst(c.def.x, c.def.y - 16, {
        count: 30,
        color: '#e8c86a',
        color2: '#fff4c8',
        speed: 160,
        size: 3,
        life: 0.85,
        grav: -50,
      });
      this.fx.ring(c.def.x, c.def.y, 8, 70, 'rgba(255,210,120,0.6)', 3, 0.5);
      this.ui.setMoney(this.player.money);
      return;
    }
    this.player.hp = this.player.maxHp;
    this.player.chi = this.player.maxChi;
    this.player.stamina = this.player.maxStamina;
    this.spawnPoint = { region: this.region.id, x: t.x + 30, y: t.y + 40 };
    this.audio.heal();
    this.ui.banner('残灯不灭', '气血与内力已复原，此处可作重生之地');
    this.fx.ring(t.x, t.y, 10, 100, 'rgba(255,200,120,0.7)', 3, 0.8);
    this.fx.burst(t.x, t.y, {
      count: 30,
      color: '#ffd27a',
      color2: '#fff6dc',
      speed: 90,
      size: 2.6,
      life: 1.2,
      grav: -30,
    });
  }

  private openNpc(npc: NpcDef) {
    const dlg = getNpcDialog(npc.id, this.flags);
    this.audio.ui();
    this.openDialogue(dlg.lines, () => this.afterDialog(npc.id));
  }

  private afterDialog(id: string) {
    if (id === 'storyteller' && !this.flags.has('story')) {
      this.flags.add('story');
      this.ui.banner('江湖路远', '新目标：穿过东门，前往枯木林');
      this.ui.toast('说书人提到了「无面」与断崖古寺');
    }
    if (id === 'merchant') {
      if (!this.flags.has('supplies')) {
        this.flags.add('supplies');
        this.player.inv.add('pill_heal', 3);
        this.ui.banner('故人一炷香', '获得 回春丹 ×3');
      }
      this.openShop();
    }
    if (id === 'blacksmith' && !this.flags.has('forge')) {
      this.flags.add('forge');
      this.player.inv.add('bone', 3);
      this.ui.banner('刀要养，人也要养', '获得 兽骨 ×3');
    }
    if (id === 'guard') {
      this.ui.toast('老秦：斩够六头影狼，其余的不敢跟。');
    }
    this.updateObjective();
  }

  private openShop() {
    this.audio.ui();
    this.ui.setPrompt(null);
    document.exitPointerLock?.();
    this.ui.openShop(this.snapshot(), this.player.money);
  }

  private useItem(id: ItemId) {
    if (!this.player.inv.has(id)) {
      this.ui.toast(`没有${ITEMS[id].name}`);
      this.audio.deny();
      return;
    }
    if (id === 'pill_heal') {
      if (this.player.hp >= this.player.maxHp) {
        this.ui.toast('气血充盈');
        return;
      }
      this.player.inv.remove(id, 1);
      this.player.heal(45, this);
      this.ui.toast('服下回春丹');
    } else if (id === 'pill_chi') {
      if (this.player.chi >= this.player.maxChi) {
        this.ui.toast('内力已满');
        return;
      }
      this.player.inv.remove(id, 1);
      this.player.restoreChi(55, this);
      this.ui.toast('服下凝神丹');
    } else if (id === 'pill_speed') {
      this.player.inv.remove(id, 1);
      this.player.buffs.speed = 10;
      this.audio.heal();
      this.ui.toast('清风入体，身法加快');
    } else if (id === 'pill_guard') {
      this.player.inv.remove(id, 1);
      this.player.buffs.guard = 8;
      this.audio.heal();
      this.ui.toast('金刚护体，伤害减半');
    } else {
      this.ui.toast('此物无法直接使用');
      return;
    }
    this.syncHud();
  }

  private buy(id: ItemId) {
    const good = SHOP_GOODS.find((g) => g.id === id);
    if (!good) return;
    if (this.player.money < good.price) {
      this.ui.toast('铜钱不够');
      this.audio.deny();
      return;
    }
    this.player.money -= good.price;
    this.player.inv.add(id, 1);
    this.audio.buy();
    this.ui.toast(`买下 ${ITEMS[id].name}`);
    this.ui.refreshPanel(this.snapshot());
    this.syncHud();
  }

  private craft(index: number) {
    const recipe = RECIPES[index];
    if (!recipe) return;
    for (const [needId, n] of recipe.need) {
      if (!this.player.inv.has(needId, n)) {
        this.ui.toast(`缺少 ${ITEMS[needId].name}`);
        this.audio.deny();
        return;
      }
    }
    for (const [needId, n] of recipe.need) this.player.inv.remove(needId, n);
    this.player.inv.add(recipe.out, recipe.count);
    this.audio.buy();
    this.ui.toast(`炼成 ${ITEMS[recipe.out].name} ×${recipe.count}`);
    this.ui.refreshPanel(this.snapshot());
    this.syncHud();
  }

  /* ------------------------------ Boss / 结局 ------------------------------ */
  private triggerBoss() {
    this.bossTriggered = true;
    this.audio.bossRoar();
    this.ui.setPrompt(null);
    this.input.mouse.down = false;
    this.openDialogue(BOSS_INTRO, () => {
      if (!this.region.boss) return;
      this.boss = new Boss3D(this.region.boss.x, this.region.boss.y);
      this.world.scene.add(this.boss.model.group);
      this.ui.showBoss('无面', this.boss.hp, this.boss.maxHp, 1);
      this.ui.banner('无 面', '「赢我。」');
      this.shake(12);
      this.audio.bossRoar();
      this.fx.rune(this.region.boss.x, this.region.boss.y, 140, '#ff4a3a', 1.2);
    });
  }

  private showVictory() {
    this.mode = 'victory';
    this.ui.hideBoss();
    const t = Math.floor(this.elapsed);
    const timeStr = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    this.ui.showVictory({ time: timeStr, kills: this.kills.total, money: this.player.money }, ENDING_LINES);
    this.audio.victory();
    this.ui.setPrompt(null);
    document.exitPointerLock?.();
  }

  /* ------------------------------ 战斗 API ------------------------------ */
  hitEnemies(x: number, y: number, angle: number, range: number, halfArc: number, damage: number, knockback = 0) {
    let hits = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist(x, y, e.x, e.y);
      if (d > range + e.r) continue;
      const a = angleTo(x, y, e.x, e.y);
      if (Math.abs(angleDiff(a, angle)) > halfArc) continue;
      e.takeDamage(damage, a, this);
      if (knockback > 0) {
        e.kbx += Math.cos(a) * knockback;
        e.kby += Math.sin(a) * knockback;
      }
      hits++;
    }
    if (this.boss && !this.boss.dead) {
      const d = dist(x, y, this.boss.x, this.boss.y);
      if (d < range + this.boss.r) {
        const a = angleTo(x, y, this.boss.x, this.boss.y);
        if (Math.abs(angleDiff(a, angle)) < halfArc + 0.35) {
          this.boss.takeDamage(damage, a, this);
          hits++;
        }
      }
    }
    return hits;
  }

  areaEnemies(x: number, y: number, radius: number, damage: number, knockback = 0) {
    let hits = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist(x, y, e.x, e.y);
      if (d > radius + e.r) continue;
      const a = angleTo(x, y, e.x, e.y);
      e.takeDamage(damage, a, this);
      if (knockback > 0) {
        e.kbx += Math.cos(a) * knockback * 0.6;
        e.kby += Math.sin(a) * knockback * 0.6;
      }
      hits++;
    }
    if (this.boss && !this.boss.dead && dist(x, y, this.boss.x, this.boss.y) < radius + this.boss.r) {
      this.boss.takeDamage(damage, angleTo(x, y, this.boss.x, this.boss.y), this);
      hits++;
    }
    return hits;
  }

  damagePlayer(amount: number, fromX: number, fromY: number) {
    this.player.takeDamage(amount, fromX, fromY, this);
  }

  shake(v: number) {
    this.shakeAmp = Math.min(34, this.shakeAmp + v);
  }

  slowmo(duration: number, scale: number) {
    this.slowT = Math.max(this.slowT, duration);
    this.slowScale = scale;
  }

  punchZoom(v: number) {
    this.punch = Math.min(16, this.punch + v);
  }

  flash(color: string, alpha: number) {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
    this.flashEl.style.backgroundColor = this.flashColor;
  }

  spawnProjectile(x: number, y: number, angle: number, speed: number, damage: number, kind: 'fire' | 'soul') {
    const p = new Projectile3D(x, y, angle, speed, damage, kind);
    this.projectiles.push(p);
    this.world.scene.add(p.group);
  }

  spawnEnemy(kind: 'wolf' | 'ghost' | 'monk' | 'boss', x: number, y: number, elite = false, name?: string, key?: string) {
    if (kind === 'boss') {
      this.boss = new Boss3D(x, y);
      this.world.scene.add(this.boss.model.group);
      return;
    }
    const e = new Enemy3D(kind, x, y, elite, name, key);
    this.enemies.push(e);
    this.world.scene.add(e.group);
    this.fx.burst(x, y, {
      count: 10,
      color: 'rgba(150,140,130,0.6)',
      color2: 'rgba(255,220,180,0.4)',
      speed: 70,
      size: 2.4,
      life: 0.4,
      grav: -20,
    });
  }

  spawnPickup(spec: PickupSpec) {
    const group = createPickupModel(spec.item, spec.money ?? 0);
    this.world.scene.add(group);
    this.pickups.push({
      x: spec.x,
      y: spec.y,
      vx: randRange(-60, 60),
      vy: randRange(-80, -20),
      item: spec.item,
      money: spec.money,
      count: spec.count ?? 1,
      life: 18,
      t: 0,
      group,
    });
  }

  private updatePickups(dt: number) {
    const p = this.player;
    for (const it of this.pickups) {
      it.t += dt;
      it.life -= dt;
      const d = dist(it.x, it.y, p.x, p.y);
      if (d < 120 && !p.dead) {
        const a = angleTo(it.x, it.y, p.x, p.y);
        const power = 780 * (1 - d / 120) + 120;
        it.vx += Math.cos(a) * power * dt;
        it.vy += Math.sin(a) * power * dt;
      }
      const drag = Math.max(0, 1 - dt * 2.2);
      it.vx *= drag;
      it.vy *= drag;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.group.position.set(it.x * S, 0.32 + Math.sin(it.t * 4) * 0.09, it.y * S);
      it.group.rotation.y += dt * 1.8;

      if (!p.dead && d < 34) {
        if (it.money) {
          p.money += it.money;
          this.fx.text(it.x, it.y - 10, `+${it.money}`, '#ffd889', 13);
          this.audio.pickup();
        }
        if (it.item) {
          p.inv.add(it.item, it.count);
          this.ui.toast(`获得 ${ITEMS[it.item].name} ×${it.count}`);
          this.audio.pickup();
        }
        it.life = 0;
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const it = this.pickups[i];
      if (it.life <= 0) {
        disposeObject(it.group);
        it.group.removeFromParent();
        this.pickups.splice(i, 1);
      }
    }
  }

  private spawnAmbient(rawDt: number) {
    this.ambientT -= rawDt;
    if (this.ambientT > 0) return;
    this.ambientT = 0.12;
    const p = this.player;
    if (this.region.id === 'cliff') {
      this.fx.embers(p.x + randRange(-260, 260), p.y + randRange(-200, 200), 1, '#ff7a4a');
    } else if (this.region.id === 'forest') {
      this.fx.burst(p.x + randRange(-300, 300), p.y + randRange(-240, 240), {
        count: 1,
        color: 'rgba(140,70,60,0.5)',
        color2: 'rgba(190,110,80,0.36)',
        speed: 10,
        size: 0.85,
        life: 5,
        grav: 16,
        drag: 0.1,
        y: 2.6,
      });
    } else {
      this.fx.burst(p.x + randRange(-300, 300), p.y + randRange(-240, 240), {
        count: 1,
        color: 'rgba(190,180,150,0.3)',
        color2: 'rgba(220,210,180,0.22)',
        speed: 6,
        size: 0.7,
        life: 5,
        grav: -8,
        drag: 0.2,
        y: 1.6 + Math.random() * 1.6,
      });
    }
  }

  toast(msg: string) {
    this.ui.toast(msg);
  }

  banner(title: string, sub?: string) {
    this.ui.banner(title, sub);
  }

  addMoney(n: number) {
    this.player.money += n;
    this.syncHud();
  }

  grantItem(id: ItemId, n: number, announce = true) {
    this.player.inv.add(id, n);
    if (announce) this.ui.toast(`获得 ${ITEMS[id].name} ×${n}`);
    this.syncHud();
  }

  onPerfectDodge() {
    this.perfectDodges++;
    if (!this.flags.has('taught_perfect')) {
      this.flags.add('taught_perfect');
      this.ui.banner('完美闪避', '时缓 · 回复内力与气力 · 刀意·破：伤害提升');
    }
  }

  onEnemyKilled(e: Enemy3D) {
    this.kills.total++;
    if (e.kind === 'wolf') this.kills.wolf++;
    if (e.kind === 'ghost') this.kills.ghost++;
    if (e.kind === 'monk') this.kills.monk++;
    this.audio.hit();
    const money = randInt(e.money[0], e.money[1]);
    this.spawnPickup({ x: e.x, y: e.y - 8, money });
    for (const [item, chance, count] of e.drops) {
      if (Math.random() < chance) this.spawnPickup({ x: e.x + randRange(-10, 10), y: e.y - 8, item, count });
    }
    if (e.key) {
      this.flags.add(e.key);
      if (e.key === 'key') {
        this.player.inv.add('key', 1);
        this.ui.banner('残破佛钥', '断崖佛门已可开启');
        this.fx.ring(e.x, e.y, 10, 150, 'rgba(230,190,100,0.9)', 4, 0.9);
      }
      this.refreshPortals();
    }
    if (e.kind === 'wolf' && this.kills.wolf >= 6 && !this.flags.has('forest_cleared')) {
      this.flags.add('forest_cleared');
      this.player.inv.add('talisman', 1);
      this.ui.banner('狼嚎渐息', '东侧通往荒寺的路开了');
      this.audio.gate();
      this.fx.ring(this.player.x, this.player.y, 20, 210, 'rgba(255,170,90,0.5)', 3, 1);
      this.refreshPortals();
    }
    this.updateObjective();
  }

  onPlayerDeath() {
    if (this.mode !== 'playing') return;
    this.mode = 'dead';
    this.audio.death();
    this.slowmo(1.2, 0.25);
    this.ui.setPrompt(null);
    this.ui.showDeath();
    document.exitPointerLock?.();
  }

  onBossDefeated() {
    this.flags.add('boss_dead');
    this.ui.hideBoss();
    this.ui.banner('无 面 · 已 斩', '红雨，停了。');
    this.shake(24);
    this.flash('#fff0dc', 0.9);
    this.slowmo(1.6, 0.25);
    this.victoryDelay = 3.4;
    this.updateObjective();
  }

  /* ------------------------------ 任务 / HUD ------------------------------ */
  private updateObjective() {
    let text: string;
    if (!this.flags.has('story')) {
      text = '与镇中说书人交谈，问明仇人去向';
    } else if (!this.flags.has('forest_cleared')) {
      text = `穿过东门，斩尽枯木林中的影狼（${Math.min(6, this.kills.wolf)}/6）`;
    } else if (!this.flags.has('key')) {
      text = '进入荒寺，击败守钥僧，夺回佛钥';
    } else if (!this.flags.has('boss_dead')) {
      text = '带着佛钥登上断崖，直面无面';
    } else {
      text = '红雨停了。断崖上只剩一把刀，和一盏未熄的灯。';
    }
    this.ui.setObjective(text);
  }

  private snapshot(): Snapshot {
    const counts: Partial<Record<ItemId, number>> = {};
    for (const id of Object.keys(ITEMS) as ItemId[]) {
      const c = this.player.inv.count(id);
      if (c > 0) counts[id] = c;
    }
    return { money: this.player.money, counts };
  }

  private syncHud() {
    const p = this.player;
    this.ui.setVitals({
      hp: p.hp,
      maxHp: p.maxHp,
      chi: p.chi,
      maxChi: p.maxChi,
      stamina: p.stamina,
      maxStamina: p.maxStamina,
    });
    this.ui.updateSkills(p.skillCd, p.chi, p.dodgeCd);
    this.ui.updateQuick(p.inv.count('pill_heal'), p.inv.count('pill_chi'));
    this.ui.setMoney(p.money);
    this.ui.setBuffs(p.buffs);
  }
}
