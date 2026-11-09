import { Camera } from '../core/camera';
import { FX } from '../core/fx';
import { Input } from '../core/input';
import { Sfx } from '../core/audio';
import { UI } from '../ui/ui';
import type { Snapshot } from '../ui/ui';
import { World } from './world';
import type { RuntimeChest, RuntimeNode } from './world';
import { Player } from './player';
import { Enemy, Projectile } from './enemies';
import { Boss } from './boss';
import { buildRegion } from '../data/regions';
import { ITEMS, RECIPES, SHOP_GOODS } from '../data/items';
import { BOSS_INTRO, ENDING_LINES, getNpcDialog } from '../data/dialogs';
import type { NpcDef, PortalDef, RegionDef, RegionId, ItemId, ChestDef, NodeDef } from '../types';
import {
  angleDiff,
  angleTo,
  clamp,
  dist,
  drawItemIcon,
  randInt,
  randRange,
  TAU,
  setPixelText,
} from '../core/utils';
import type { GameRef, PickupSpec } from './api';

const VW = 1280;
const VH = 720;

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
}

type Interactable =
  | { kind: 'npc'; npc: NpcDef; d: number }
  | { kind: 'portal'; portal: PortalDef; d: number }
  | { kind: 'node'; node: RuntimeNode; d: number }
  | { kind: 'chest'; chest: RuntimeChest; d: number }
  | { kind: 'shrine'; x: number; y: number; d: number };

export const ASSET_NAMES = [
  'assets/tiles/town.jpg',
  'assets/tiles/forest.jpg',
  'assets/tiles/temple.jpg',
  'assets/tiles/cliff.jpg',
  'assets/art/title.jpg',
  'assets/art/boss.jpg',
  'assets/art/merchant.jpg',
];

export async function loadAssets(): Promise<Record<string, HTMLImageElement>> {
  const out: Record<string, HTMLImageElement> = {};
  await Promise.all(
    ASSET_NAMES.map(
      (name) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            out[name] = img;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = `./${name}`;
        }),
    ),
  );
  return out;
}

export class Game implements GameRef {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  input: Input;
  audio = new Sfx();
  fx = new FX();
  camera = new Camera(VW, VH);
  ui: UI;

  player = new Player();
  world!: World;
  region!: RegionDef;
  enemies: Enemy[] = [];
  boss: Boss | null = null;
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  flags = new Set<string>();
  openedChests = new Set<string>();
  goneNodes = new Set<string>();

  mode: 'title' | 'playing' | 'dead' | 'victory' = 'title';
  time = 0;
  elapsed = 0;
  timeScale = 1;
  slowT = 0;
  slowScale = 1;
  flashColor = 'rgba(255,255,255,X)';
  flashAlpha = 0;
  kills = { wolf: 0, ghost: 0, monk: 0, total: 0 };
  perfectDodges = 0;

  private patterns: Record<string, CanvasPattern | null> = {};
  private iconCanvases = new Map<ItemId, HTMLCanvasElement>();
  private lightCanvas: HTMLCanvasElement;
  private lightCtx: CanvasRenderingContext2D;
  private last = 0;
  private ambientT = 0;
  private promptTarget: Interactable | null = null;
  private bossTriggered = false;
  private victoryDelay = 0;
  private spawnPoint: { region: RegionId; x: number; y: number } = { region: 'town', x: 1060, y: 1020 };
  private started = false;
  private fpsTime = 0;

  constructor(canvas: HTMLCanvasElement, assets: Record<string, HTMLImageElement>) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    canvas.width = VW;
    canvas.height = VH;
    this.ctx.imageSmoothingEnabled = false;
    this.input = new Input(canvas);

    this.lightCanvas = document.createElement('canvas');
    this.lightCanvas.width = VW;
    this.lightCanvas.height = VH;
    this.lightCtx = this.lightCanvas.getContext('2d')!;

    for (const id of Object.keys(ITEMS) as ItemId[]) {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const cx = c.getContext('2d')!;
      // 懒加载绘制由 utils 完成
      void cx;
      this.iconCanvases.set(id, c);
    }

    for (const key of ['town', 'forest', 'temple', 'cliff']) {
      const img = assets[`assets/tiles/${key}.jpg`];
      this.patterns[key] = img ? this.makePattern(img) : null;
    }

    this.ui = new UI(document.getElementById('ui')!, {
      onStart: () => this.startRun(),
      onRespawn: () => this.respawn(),
      onRestart: () => this.restart(),
      onTitle: () => this.toTitle(),
      onUseItem: (id) => {
        this.useItem(id);
        this.ui.refreshPanel(this.snapshot());
      },
      onBuy: (id) => {
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
        this.ui.toast(`购得 ${ITEMS[id].name} ×1`);
        this.ui.refreshShop(this.snapshot());
        this.syncHud();
      },
      onCraft: (index) => {
        const recipe = RECIPES[index];
        if (!recipe) return;
        const ok = recipe.need.every(([id, n]) => this.player.inv.count(id) >= n);
        if (!ok) {
          this.ui.toast('药材不足');
          this.audio.deny();
          return;
        }
        for (const [id, n] of recipe.need) this.player.inv.remove(id, n);
        this.player.inv.add(recipe.out, recipe.count);
        this.audio.buy();
        this.ui.toast(`炼成 ${ITEMS[recipe.out].name} ×${recipe.count}`);
        this.ui.refreshShop(this.snapshot());
        this.syncHud();
      },
      onClosePanel: () => {
        this.ui.setPrompt(null);
      },
      onResume: () => {
        this.audio.ui();
      },
      onDialogueEnd: () => {
        this.input.pressed.clear();
        this.input.mouse.clicked = false;
      },
    });

    this.buildIcons();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // 起始区域（标题背景之下）
    this.loadRegion('town', 1060, 1020, false);

    window.addEventListener('keydown', (e) => this.onGlobalKey(e));
    requestAnimationFrame(this.frame);
  }

  private buildIcons() {
    for (const id of Object.keys(ITEMS) as ItemId[]) {
      const c = this.iconCanvases.get(id)!;
      const cx = c.getContext('2d')!;
      cx.clearRect(0, 0, 32, 32);
      drawItemIcon(cx, id, 32);
    }
  }

  private makePattern(img: HTMLImageElement) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = true;
    // 裁掉右下角水印区域，取左上 80% 作为可循环底纹
    cx.drawImage(img, 0, 0, img.width * 0.8, img.height * 0.8, 0, 0, 256, 256);
    const pat = this.ctx.createPattern(c, 'repeat');
    return pat;
  }

  private resize() {
    const scale = Math.min(window.innerWidth / VW, window.innerHeight / VH);
    this.canvas.style.width = `${Math.floor(VW * scale)}px`;
    this.canvas.style.height = `${Math.floor(VH * scale)}px`;
  }

  /* ------------------------------- 流程 ------------------------------- */
  private startRun() {
    this.audio.init();
    this.audio.startDrone();
    this.flags.clear();
    this.openedChests.clear();
    this.goneNodes.clear();
    this.kills = { wolf: 0, ghost: 0, monk: 0, total: 0 };
    this.perfectDodges = 0;
    this.player = new Player();
    this.player.reset(1060, 1020);
    this.player.money = 80;
    this.player.inv.add('pill_heal', 2);
    this.player.inv.add('pill_chi', 1);
    this.mode = 'playing';
    this.started = true;
    this.elapsed = 0;
    this.slowT = 0;
    this.flashAlpha = 0;
    this.spawnPoint = { region: 'town', x: 1060, y: 1020 };
    this.ui.showHUD();
    this.loadRegion('town', 1060, 1020, true);
    this.ui.setMoney(this.player.money);
    this.ui.toast('WASD 移动 · 左键挥刀 · 1/2/3 武学');
    this.updateObjective();
    this.ui.showDialogue(
      [
        { speaker: '旁白', text: '三日前，烬门在一场红雨里灭了。' },
        { speaker: '旁白', text: '师父把刀塞进你手里，只说了最后一句话——「别相信脸」。' },
        { speaker: '旁白', text: '你追着凶手的痕迹，来到青石镇。' },
      ],
      () => {
        this.ui.toast('去找镇中的说书人问问吧');
      },
    );
  }

  private restart() {
    this.ui.hideVictory();
    this.ui.showHUD();
    this.startRun();
  }

  private toTitle() {
    this.mode = 'title';
    this.ui.hideDeath();
    this.ui.hideVictory();
    this.ui.showTitle();
    this.audio.setRegionMood(0);
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
    this.camera.snap(this.player.x, this.player.y);
  }

  private loadRegion(id: RegionId, x: number, y: number, announce: boolean) {
    this.region = buildRegion(id);
    this.world = new World(this.region, this.openedChests, this.goneNodes);
    this.enemies = [];
    this.boss = null;
    this.projectiles = [];
    this.pickups = [];
    this.fx.clear();
    this.promptTarget = null;
    this.ui.setPrompt(null);
    this.ui.hideBoss();
    this.bossTriggered = false;
    this.victoryDelay = 0;

    this.player.x = x;
    this.player.y = y;
    this.player.kbx = 0;
    this.player.kby = 0;
    this.player.dodgeT = 0;
    this.player.dashT = 0;
    this.player.channel = 0;
    this.player.invuln = Math.max(this.player.invuln, 0.6);
    this.player.dead = false;

    for (const spawn of this.region.spawns) {
      if (spawn.key && this.flags.has(spawn.key)) continue;
      for (let i = 0; i < spawn.count; i++) {
        const ox = spawn.count === 1 ? 0 : randRange(-spawn.radius, spawn.radius);
        const oy = spawn.count === 1 ? 0 : randRange(-spawn.radius, spawn.radius);
        const pos = this.world.collide(spawn.x + ox, spawn.y + oy, 16);
        this.enemies.push(new Enemy(spawn.kind as 'wolf' | 'ghost' | 'monk', pos.x, pos.y, spawn.elite, spawn.name, spawn.key));
      }
    }

    this.camera.snap(x, y);
    this.camera.update(0.016, x, y, this.region.w, this.region.h);
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

  /* ------------------------------- 主循环 ------------------------------- */
  private frame = (now: number) => {
    const rawDt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    this.time += rawDt;

    if (this.mode === 'playing' && !this.ui.isOpen()) {
      if (this.victoryDelay > 0) {
        this.victoryDelay -= rawDt;
        if (this.victoryDelay <= 0) this.showVictory();
      }
      this.timeScale = this.slowT > 0 ? this.slowScale : 1;
      if (this.slowT > 0) this.slowT -= rawDt;
      const dt = rawDt * this.timeScale;
      this.update(dt, rawDt);
      this.elapsed += rawDt;
    } else {
      this.timeScale = 1;
      this.flashAlpha = Math.max(0, this.flashAlpha - rawDt * 2.4);
    }

    if (this.mode !== 'title') this.render(rawDt);
    this.input.endFrame();
    requestAnimationFrame(this.frame);
  };

  private update(dt: number, rawDt: number) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = (this.input.mouse.x / Math.max(1, rect.width)) * VW;
    const my = (this.input.mouse.y / Math.max(1, rect.height)) * VH;
    const wp = this.camera.screenToWorld(mx, my);
    const aim = angleTo(this.player.x, this.player.y - 10, wp.x, wp.y);

    this.player.update(dt, this.input, aim, this);

    for (const e of this.enemies) e.update(dt, this);
    this.enemies = this.enemies.filter((e) => !e.dead);
    if (this.boss) {
      this.boss.update(dt, this);
      if (this.boss && this.boss.dead) {
        this.boss = null;
      }
    }
    for (const p of this.projectiles) p.update(dt, this);
    this.projectiles = this.projectiles.filter((p) => !p.dead);

    this.updatePickups(dt);
    this.world.update(dt);

    this.fx.update(dt);
    this.flashAlpha = Math.max(0, this.flashAlpha - rawDt * 2.6);
    this.spawnAmbient(rawDt);

    this.camera.update(rawDt, this.player.x, this.player.y, this.region.w, this.region.h);

    // 悬崖 Boss 触发
    if (this.region.boss && !this.bossTriggered && !this.flags.has('boss_dead') && this.player.x > this.region.boss.triggerX) {
      this.triggerBoss();
    }

    // 交互物
    this.promptTarget = this.findInteractable();
    if (this.promptTarget) {
      const text = this.promptText(this.promptTarget);
      this.ui.setPrompt(text);
      if (this.input.wasPressed('KeyE')) {
        this.interact(this.promptTarget);
      }
    } else {
      this.ui.setPrompt(null);
    }

    // 快捷服丹
    if (this.input.wasPressed('KeyQ')) this.useItem('pill_heal');
    if (this.input.wasPressed('KeyR')) this.useItem('pill_chi');

    this.syncHud();
    if (this.boss && !this.boss.dead) {
      this.ui.showBoss('无面', this.boss.hp, this.boss.maxHp, this.boss.phase);
    } else {
      this.ui.hideBoss();
    }
  }

  /* ------------------------------- 交互 ------------------------------- */
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
      if (d < 74) consider({ kind: 'node', node, d });
    }
    for (const chest of this.world.chests) {
      if (chest.opened) continue;
      const d = dist(px, py, chest.def.x, chest.def.y);
      if (d < 76) consider({ kind: 'chest', chest, d });
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
      this.ui.fade(() => {
        this.loadRegion(t.portal.to, t.portal.tx, t.portal.ty, true);
      });
      return;
    }
    if (t.kind === 'node') {
      const def = t.node.def;
      t.node.alive = false;
      t.node.timer = 45;
      this.goneNodes.add(def.id);
      this.player.inv.add(def.item, def.count);
      this.audio.pickup();
      this.ui.toast(`获得 ${ITEMS[def.item].name} ×${def.count}`);
      this.fx.burst(def.x, def.y - 10, {
        count: 16,
        color: def.item === 'ghostfire' ? '#63e8d6' : '#7ad08e',
        color2: '#e8ffdc',
        speed: 100,
        size: 2.6,
        life: 0.7,
        grav: -40,
      });
      setTimeout(() => this.goneNodes.delete(def.id), 45000);
      return;
    }
    if (t.kind === 'chest') {
      const c = t.chest;
      c.opened = true;
      this.openedChests.add(c.def.id);
      if (c.def.money) this.player.money += c.def.money;
      if (c.def.item) this.player.inv.add(c.def.item, c.def.count ?? 1);
      this.audio.buy();
      const parts: string[] = [];
      if (c.def.money) parts.push(`${c.def.money} 文`);
      if (c.def.item) parts.push(`${ITEMS[c.def.item].name} ×${c.def.count ?? 1}`);
      this.ui.toast(`开箱：${parts.join(' · ')}`);
      this.fx.burst(c.def.x, c.def.y - 16, {
        count: 24,
        color: '#e8c86a',
        color2: '#fff4c8',
        speed: 150,
        size: 2.8,
        life: 0.7,
        grav: -50,
      });
      this.ui.setMoney(this.player.money);
      return;
    }
    // shrine
    this.player.hp = this.player.maxHp;
    this.player.chi = this.player.maxChi;
    this.player.stamina = this.player.maxStamina;
    this.player.money = this.player.money;
    this.spawnPoint = {
      region: this.region.id,
      x: t.x + 30,
      y: t.y + 40,
    };
    this.audio.heal();
    this.ui.banner('残灯不灭', '气血与内力已复原，此处可作重生之地');
    this.fx.ring(t.x, t.y - 30, 10, 90, 'rgba(255,200,120,0.7)', 3, 0.7);
    this.fx.burst(t.x, t.y - 30, {
      count: 24,
      color: '#ffd27a',
      color2: '#fff6dc',
      speed: 80,
      size: 2.4,
      life: 1.1,
      grav: -30,
    });
  }

  private openNpc(npc: NpcDef) {
    const dlg = getNpcDialog(npc.id, this.flags);
    this.audio.ui();
    this.ui.setPrompt(null);
    this.ui.showDialogue(dlg.lines, () => this.afterDialog(npc.id));
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
      this.ui.toast('服下凝神散');
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

  private triggerBoss() {
    this.bossTriggered = true;
    this.audio.bossRoar();
    this.ui.setPrompt(null);
    this.ui.showDialogue(BOSS_INTRO, () => {
      if (!this.region.boss) return;
      this.boss = new Boss(this.region.boss.x, this.region.boss.y);
      this.ui.showBoss('无面', this.boss.hp, this.boss.maxHp, 1);
      this.ui.banner('无 面', '「赢我。」');
      this.camera.addShake(12);
      this.audio.bossRoar();
      this.fx.rune(this.region.boss.x, this.region.boss.y, 130, '#ff4a3a', 1.1);
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
  }

  /* ------------------------------- 战斗 API ------------------------------- */
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
    this.camera.addShake(v);
  }

  slowmo(duration: number, scale: number) {
    this.slowT = Math.max(this.slowT, duration);
    this.slowScale = scale;
  }

  punchZoom(v: number) {
    this.camera.punch(v);
  }

  flash(color: string, alpha: number) {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  spawnProjectile(x: number, y: number, angle: number, speed: number, damage: number, kind: 'fire' | 'soul') {
    this.projectiles.push(new Projectile(x, y, angle, speed, damage, kind));
  }

  spawnEnemy(kind: 'wolf' | 'ghost' | 'monk' | 'boss', x: number, y: number, elite = false, name?: string, key?: string) {
    if (kind === 'boss') {
      this.boss = new Boss(x, y);
      return new Enemy('monk', x, y, elite, name, key);
    }
    const e = new Enemy(kind, x, y, elite, name, key);
    this.enemies.push(e);
    return e;
  }

  spawnPickup(spec: PickupSpec) {
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
    });
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

  onEnemyKilled(e: Enemy) {
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
        this.fx.ring(e.x, e.y, 10, 140, 'rgba(230,190,100,0.9)', 4, 0.8);
      }
    }
    if (e.kind === 'wolf' && this.kills.wolf >= 6 && !this.flags.has('forest_cleared')) {
      this.flags.add('forest_cleared');
      this.player.inv.add('talisman', 1);
      this.ui.banner('狼嚎渐息', '东侧通往荒寺的路开了');
      this.audio.gate();
      this.fx.ring(this.player.x, this.player.y, 20, 200, 'rgba(255,170,90,0.5)', 3, 0.9);
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
  }

  onBossDefeated() {
    this.flags.add('boss_dead');
    this.boss = null;
    this.ui.hideBoss();
    this.ui.banner('无 面 · 已 斩', '红雨，停了。');
    this.camera.addShake(24);
    this.flash('rgba(255,240,220,X)', 0.9);
    this.slowmo(1.6, 0.25);
    this.victoryDelay = 3.4;
    this.updateObjective();
  }

  /* ------------------------------- 拾取 ------------------------------- */
  private updatePickups(dt: number) {
    for (const p of this.pickups) {
      p.life -= dt;
      p.t += dt;
      const d = dist(p.x, p.y, this.player.x, this.player.y - 10);
      if (d < 120) {
        const a = angleTo(p.x, p.y, this.player.x, this.player.y - 10);
        const pull = 320 + (120 - d) * 6;
        p.vx += Math.cos(a) * pull * dt;
        p.vy += Math.sin(a) * pull * dt;
        p.vx *= 0.9;
        p.vy *= 0.9;
      } else {
        p.vx *= 1 - 2.2 * dt;
        p.vy *= 1 - 2.2 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (d < 26 || p.life <= 0) {
        if (d < 26) {
          if (p.money) {
            this.player.money += p.money;
            this.audio.pickup();
            this.ui.toast(`+${p.money} 文`);
            this.ui.setMoney(this.player.money);
          }
          if (p.item) {
            this.player.inv.add(p.item, p.count);
            this.audio.pickup();
            this.ui.toast(`获得 ${ITEMS[p.item].name} ×${p.count}`);
          }
          this.fx.burst(p.x, p.y, {
            count: 6,
            color: p.money ? '#e8c86a' : '#8ed6a2',
            color2: '#fff4c8',
            speed: 80,
            size: 2,
            life: 0.4,
          });
        }
        p.life = 0;
      }
    }
    this.pickups = this.pickups.filter((p) => p.life > 0);
  }

  private spawnAmbient(dt: number) {
    this.ambientT -= dt;
    if (this.ambientT > 0) return;
    this.ambientT = 0.14;
    const cx = this.camera.cx + randRange(-520, 520);
    const cy = this.camera.cy + randRange(-320, 320);
    if (this.region.id === 'forest') {
      this.fx.burst(cx, cy - 120, {
        count: 1,
        color: '#7a3a34',
        color2: '#b3543f',
        speed: 8,
        size: 2.2,
        life: 6,
        grav: 26,
        shape: 'petal',
        glow: false,
        spread: 0.4,
        drag: 0.2,
      });
    } else if (this.region.id === 'cliff') {
      this.fx.burst(cx, cy + 120, {
        count: 1,
        color: '#ff7a45',
        color2: '#ffd27a',
        speed: 14,
        size: 1.8,
        life: 4,
        grav: -30,
        shape: 'ember',
        spread: 0.5,
        drag: 0.3,
      });
    } else {
      this.fx.burst(cx, cy + 80, {
        count: 1,
        color: 'rgba(190,180,150,0.5)',
        speed: 6,
        size: 1.6,
        life: 5,
        grav: -8,
        shape: 'smoke',
        glow: false,
        drag: 0.2,
      });
    }
  }

  /* ------------------------------- 任务 ------------------------------- */
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
    this.ui.setVitals(this.player);
    this.ui.updateSkills(this.player.skillCd, this.player.chi, this.player.dodgeCd);
    this.ui.updateQuick(this.player.inv.count('pill_heal'), this.player.inv.count('pill_chi'));
    this.ui.setMoney(this.player.money);
    this.ui.setBuffs(this.player.buffs);
  }

  /* ------------------------------- 键盘 ------------------------------- */
  private onGlobalKey(e: KeyboardEvent) {
    if (this.mode !== 'playing' || this.ui.isDialogueOpen()) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      if (this.ui.isPanelOpen()) {
        this.ui.closePanel();
      } else {
        this.audio.ui();
        this.ui.setPrompt(null);
        this.ui.openInventory(this.snapshot());
      }
    } else if (e.code === 'Escape') {
      e.preventDefault();
      if (this.ui.isPanelOpen()) this.ui.closePanel();
      else {
        this.audio.ui();
        this.ui.openPause();
      }
    } else if (e.code === 'KeyH') {
      if (this.ui.isPanelOpen()) this.ui.closePanel();
      else {
        this.audio.ui();
        this.ui.openHelp();
      }
    } else if (e.code === 'KeyM') {
      this.audio.setMuted(!this.audio.muted);
      this.ui.toast(this.audio.muted ? '已静音' : '已恢复声音');
    }
  }

  /* ------------------------------- 渲染 ------------------------------- */
  private render(rawDt: number) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07090d';
    ctx.fillRect(0, 0, VW, VH);

    if (this.mode === 'title') return;

    this.camera.apply(ctx);

    const pattern = this.patterns[this.region.ground] ?? null;
    this.world.drawGround(ctx, pattern, this.time);

    // 传送门光效在地面层
    for (const p of this.region.portals) {
      const unlocked = !p.need || this.flags.has(p.need);
      const near = dist(this.player.x, this.player.y, p.x, p.y) < 240;
      this.world.drawPortal(ctx, p.x, p.y, this.time, unlocked, near);
    }

    type Drawable = { y: number; draw: () => void };
    const list: Drawable[] = [];

    for (const prop of this.region.props) {
      list.push({ y: prop.y, draw: () => this.world.drawProp(ctx, prop, this.time) });
    }
    for (const node of this.world.nodes) {
      if (!node.alive) continue;
      list.push({ y: node.def.y, draw: () => this.world.drawNode(ctx, node, this.time) });
    }
    for (const chest of this.world.chests) {
      list.push({ y: chest.def.y, draw: () => this.world.drawChest(ctx, chest, this.time) });
    }
    for (const npc of this.region.npcs) {
      list.push({ y: npc.y, draw: () => this.drawNpc(ctx, npc) });
    }
    for (const e of this.enemies) {
      list.push({ y: e.y, draw: () => e.draw(ctx, this.time) });
    }
    if (this.boss) {
      list.push({ y: this.boss.y, draw: () => this.boss!.draw(ctx, this.time) });
    }
    list.push({ y: this.player.y, draw: () => this.player.draw(ctx, this.time) });
    for (const p of this.pickups) {
      list.push({ y: p.y, draw: () => this.drawPickup(ctx, p) });
    }
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();

    for (const p of this.projectiles) p.draw(ctx, this.time);

    this.fx.draw(ctx);
    this.player.drawOverlay(ctx, this.time);

    this.camera.restore(ctx);

    this.drawLighting();
    this.drawGlow();
    this.drawFlash();

    void rawDt;
  }

  private drawNpc(ctx: CanvasRenderingContext2D, npc: NpcDef) {
    const time = this.time;
    ctx.save();
    ctx.translate(Math.round(npc.x), Math.round(npc.y));
    ctx.globalAlpha = 0.36;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 4, 14, 6, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    const bob = Math.sin(time * 2 + npc.x) * 0.8;
    // 袍子
    ctx.fillStyle = npc.color;
    ctx.beginPath();
    ctx.moveTo(-10, -6);
    ctx.lineTo(-8, -34 + bob);
    ctx.lineTo(8, -34 + bob);
    ctx.lineTo(11, -6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(-9, -24 + bob, 18, 2);
    // 头
    ctx.fillStyle = '#d8b28c';
    ctx.beginPath();
    ctx.arc(0, -40 + bob, 6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2a2a2e';
    ctx.beginPath();
    ctx.ellipse(0, -45 + bob, 7, 3, 0, 0, TAU);
    ctx.fill();

    // 辨识特征
    if (npc.id === 'storyteller') {
      ctx.fillStyle = '#d8d0c0';
      ctx.fillRect(-3, -38 + bob, 6, 8);
      ctx.strokeStyle = '#c9a34f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(11, -26 + bob, 7, -0.8, 1.2);
      ctx.stroke();
    } else if (npc.id === 'merchant') {
      ctx.fillStyle = '#1a1a1e';
      ctx.fillRect(-5, -42 + bob, 4, 3);
      ctx.fillRect(1, -42 + bob, 4, 3);
      ctx.fillStyle = '#2f5a42';
      ctx.fillRect(-1, -46 + bob, 6, 3);
    } else if (npc.id === 'blacksmith') {
      ctx.fillStyle = '#3a2c20';
      ctx.fillRect(11, -30 + bob, 3, 18);
      ctx.fillStyle = '#6a6a70';
      ctx.fillRect(9, -34 + bob, 8, 6);
    } else if (npc.id === 'guard') {
      ctx.strokeStyle = '#6a5a40';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(13, -50);
      ctx.lineTo(13, -2);
      ctx.stroke();
      ctx.fillStyle = '#b8c0cc';
      ctx.beginPath();
      ctx.moveTo(13, -56);
      ctx.lineTo(17, -48);
      ctx.lineTo(9, -48);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 名字
    ctx.save();
    ctx.translate(npc.x, npc.y);
    setPixelText(ctx, 12);
    ctx.fillStyle = 'rgba(8,10,14,0.7)';
    const name = npc.name;
    const width = ctx.measureText(name).width + 12;
    ctx.fillRect(-width / 2, -74, width, 17);
    ctx.fillStyle = 'rgba(217,184,120,0.9)';
    ctx.fillText(name, 0, -65.5);
    ctx.restore();

    // 任务感叹号
    const need =
      (npc.id === 'storyteller' && !this.flags.has('story')) ||
      (npc.id === 'merchant' && !this.flags.has('supplies')) ||
      (npc.id === 'blacksmith' && !this.flags.has('forge'));
    if (need) {
      ctx.save();
      ctx.translate(npc.x, npc.y - 86 + Math.sin(time * 4) * 3);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ffd27a';
      ctx.font = 'bold 20px serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', 0, 0);
      ctx.restore();
    }
  }

  private drawPickup(ctx: CanvasRenderingContext2D, p: Pickup) {
    ctx.save();
    ctx.translate(p.x, p.y - 6 + Math.sin(p.t * 5) * 2);
    if (p.money) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(232,200,106,0.25)';
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#e8c86a';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#8a6a2a';
      ctx.fillRect(-1.5, -1.5, 3, 3);
    } else if (p.item) {
      const icon = this.iconCanvases.get(p.item);
      if (icon) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(200,220,180,0.18)';
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(icon, -12, -12, 24, 24);
        if (p.count > 1) {
          ctx.font = '10px serif';
          ctx.fillStyle = '#fff4d8';
          ctx.fillText(`×${p.count}`, 8, 12);
        }
      }
    }
    if (p.life < 4) {
      ctx.globalAlpha = 0.4 + Math.sin(p.t * 16) * 0.35;
    }
    ctx.restore();
  }

  private drawLighting() {
    const lctx = this.lightCtx;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, VW, VH);
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = `rgba(4,6,11,${this.region.dark})`;
    lctx.fillRect(0, 0, VW, VH);
    lctx.globalCompositeOperation = 'destination-out';

    const zoom = this.camera.zoom;
    const toScreen = (x: number, y: number) => ({
      x: (x - this.camera.cx) * zoom + VW / 2 + this.camera.sx,
      y: (y - this.camera.cy) * zoom + VH / 2 + this.camera.sy,
    });

    const lights = [
      { x: this.player.x, y: this.player.y - 18, r: 280, flicker: 0 },
      ...this.world.lights(this.time),
    ];
    if (this.boss) lights.push({ x: this.boss.x, y: this.boss.y - 20, r: 220, color: 'rgba(255,60,40,0.8)', flicker: 0.3 });
    for (const fx of [this.player.x]) void fx;

    for (const l of lights) {
      const s = toScreen(l.x, l.y);
      const radius = l.r * zoom;
      if (s.x < -radius || s.x > VW + radius || s.y < -radius || s.y > VH + radius) continue;
      const flick = l.flicker ? 1 + Math.sin(this.time * 11 + l.x) * 0.05 * l.flicker : 1;
      const g = lctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, radius * flick);
      g.addColorStop(0, 'rgba(0,0,0,0.95)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.6)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = g;
      lctx.beginPath();
      lctx.arc(s.x, s.y, radius * flick, 0, TAU);
      lctx.fill();
    }

    lctx.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(this.lightCanvas, 0, 0);
  }

  private drawGlow() {
    const ctx = this.ctx;
    const zoom = this.camera.zoom;
    const toScreen = (x: number, y: number) => ({
      x: (x - this.camera.cx) * zoom + VW / 2 + this.camera.sx,
      y: (y - this.camera.cy) * zoom + VH / 2 + this.camera.sy,
    });
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lights = this.world.lights(this.time);
    for (const l of lights) {
      if (!l.color.includes('255')) continue;
      const s = toScreen(l.x, l.y);
      const radius = l.r * zoom * 0.9;
      if (s.x < -radius || s.x > VW + radius || s.y < -radius || s.y > VH + radius) continue;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, radius);
      g.addColorStop(0, l.color.replace(/[\d.]+\)$/, '0.16)'));
      g.addColorStop(0.5, l.color.replace(/[\d.]+\)$/, '0.05)'));
      g.addColorStop(1, l.color.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = g;
      ctx.fillRect(s.x - radius, s.y - radius, radius * 2, radius * 2);
    }
    ctx.restore();
  }

  private drawFlash() {
    if (this.flashAlpha <= 0.01) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = this.flashColor.replace('X', String(this.flashAlpha));
    ctx.fillRect(-10, -10, VW + 20, VH + 20);
    ctx.restore();
  }
}

export { VW, VH };
