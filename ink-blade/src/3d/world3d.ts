import * as THREE from 'three';
import type { ChestDef, NodeDef, NpcDef, PortalDef, PropKind, RegionDef } from '../types';
import { assetUrl } from '../core/assets';
import {
  S,
  createChestModel,
  createNodeModel,
  createNpcModel,
  createPortalModel,
  createPropModel,
  createShrineModel,
  disposeObject,
  glowSprite,
  M,
} from './models';

export interface RuntimeNode {
  def: NodeDef;
  alive: boolean;
  timer: number;
  group: THREE.Group;
}

export interface RuntimeChest {
  def: ChestDef;
  opened: boolean;
  lid: THREE.Group;
  group: THREE.Group;
}

interface PortalVis {
  def: PortalDef;
  group: THREE.Group;
  ring: THREE.Mesh;
  glow: THREE.Object3D;
  unlocked: boolean;
}

interface Palette {
  sky: number;
  fog: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  dir: number;
  dirI: number;
}

const PALETTES: Record<string, Palette> = {
  town: { sky: 0x0d1420, fog: 0x0b1119, fogDensity: 0.024, hemiSky: 0x9db2cc, hemiGround: 0x2c241a, hemiI: 1.2, dir: 0xb6cbe2, dirI: 1.9 },
  forest: { sky: 0x091310, fog: 0x07110e, fogDensity: 0.033, hemiSky: 0x82a394, hemiGround: 0x1a2317, hemiI: 1.0, dir: 0xa8cbaf, dirI: 1.5 },
  temple: { sky: 0x0b1019, fog: 0x090e15, fogDensity: 0.029, hemiSky: 0x8d9dbd, hemiGround: 0x1f1a26, hemiI: 1.05, dir: 0xb1c0dc, dirI: 1.65 },
  cliff: { sky: 0x140b0c, fog: 0x100809, fogDensity: 0.029, hemiSky: 0xb89490, hemiGround: 0x2c1410, hemiI: 1.05, dir: 0xd6a8a2, dirI: 1.8 },
};

const FOOT: Partial<Record<PropKind, [number, number]>> = {
  tree: [48, 48],
  deadwood: [38, 38],
  rock: [58, 58],
  boulder: [88, 88],
  bamboo: [38, 38],
  lantern: [26, 26],
  torch: [22, 22],
  grass: [0, 0],
  statue: [64, 64],
  pillar: [40, 40],
  banner: [26, 26],
  well: [86, 86],
  stall: [0, 0],
  bones: [0, 0],
  shrine: [68, 68],
  censer: [52, 52],
  brazier: [46, 46],
  gate: [0, 0],
  fence: [130, 24],
  house: [0, 0],
};

interface Solid {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export class World3D {
  scene = new THREE.Scene();
  region: RegionDef;
  solids: Solid[] = [];
  nodes: RuntimeNode[] = [];
  chests: RuntimeChest[] = [];
  npcGroups = new Map<string, THREE.Group>();
  portals: PortalVis[] = [];
  shrineGroup: THREE.Group | null = null;

  private groundTex: THREE.Texture | null = null;
  private time = 0;
  private extraLights: THREE.PointLight[] = [];

  constructor(region: RegionDef, openedChests: Set<string>, goneNodes: Set<string>) {
    this.region = region;
    const pal = PALETTES[region.id] ?? PALETTES.town;
    this.scene.background = new THREE.Color(pal.sky);
    this.scene.fog = new THREE.FogExp2(pal.fog, pal.fogDensity);

    const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiI);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(pal.dir, pal.dirI);
    dir.position.set(16, 26, -12);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(pal.hemiSky, 0.35);
    fill.position.set(-18, 10, 14);
    this.scene.add(fill);

    this.buildGround();
    this.buildProps();
    this.buildNpcs();
    this.buildPortals();
    this.buildNodes(goneNodes);
    this.buildChests(openedChests);
    this.buildShrine();

    this.scene.add(glowSprite(region.id === 'cliff' ? '#ff5a3a' : '#7fa8d8', 42, 0.07).translateY(24));
  }

  private buildGround() {
    const r = this.region;
    const tex = new THREE.TextureLoader().load(assetUrl('tiles', r.ground));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(2, r.w / 240), Math.max(2, r.h / 240));
    tex.anisotropy = 4;
    this.groundTex = tex;

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      color: r.id === 'forest' ? 0x7f9588 : r.id === 'cliff' ? 0x9a7a72 : 0x8f97a8,
      roughness: 1,
      metalness: 0,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry((r.w * S) + 8, (r.h * S) + 8), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((r.w * S) / 2, 0, (r.h * S) / 2);
    this.scene.add(ground);

    // 场地边缘的暗色雾气带
    const edgeMat = new THREE.MeshBasicMaterial({
      color: r.id === 'cliff' ? 0x2a1012 : 0x0a0d12,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const h = 2.4;
    const w = r.w * S;
    const d = r.h * S;
    const walls: [number, number, number, number, number][] = [
      [w / 2, 0, w, h, 0],
      [w / 2, d, w, h, 0],
      [0, d / 2, d, h, 1],
      [w, d / 2, d, h, 1],
    ];
    for (const [x, z, len, hh, rot] of walls) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, hh), edgeMat);
      wall.position.set(x, hh / 2, z);
      wall.rotation.y = rot ? Math.PI / 2 : 0;
      this.scene.add(wall);
    }
  }

  private buildProps() {
    const r = this.region;
    r.props.forEach((p, idx) => {
      const model = createPropModel(p.kind, p.scale ?? 1, p.variant ?? idx, p.w, p.h);
      model.position.set(p.x * S, 0, p.y * S);
      this.scene.add(model);

      if (p.solid === false) return;
      const def = FOOT[p.kind] ?? [40, 40];
      let fw = def[0];
      let fh = def[1];
      if (p.kind === 'house') {
        fw = p.w ?? 300;
        fh = p.h ?? 170;
      } else if (p.kind === 'stall') {
        fw = p.w ?? 140;
        fh = p.h ?? 64;
      } else {
        fw = Math.max(fw, p.w ?? 0);
        fh = Math.max(fh, p.h ?? 0);
      }
      const sc = p.scale ?? 1;
      fw *= sc;
      fh *= sc;
      if (fw < 4 || fh < 4) return;
      this.solids.push({ x: p.x - fw / 2, y: p.y - fh / 2, w: fw, h: fh });
    });

    // 少量火光，避免点光源过多
    const lights: [number, number][] = [];
    for (const p of r.props) {
      if ((p.kind === 'torch' || p.kind === 'brazier' || p.kind === 'censer') && lights.length < 6) {
        lights.push([p.x, p.y]);
      }
    }
    for (const [x, y] of lights) {
      const light = new THREE.PointLight(r.id === 'forest' ? 0xff9a4a : 0xffb45a, 26, 11, 2);
      light.position.set(x * S, 1.7, y * S);
      this.scene.add(light);
      this.extraLights.push(light);
    }
  }

  private buildNpcs() {
    for (const npc of this.region.npcs) {
      const m = createNpcModel(npc.color);
      m.group.position.set(npc.x * S, 0, npc.y * S);
      this.scene.add(m.group);
      this.npcGroups.set(npc.id, m.group);
      this.solids.push({ x: npc.x - 18, y: npc.y - 18, w: 36, h: 36 });
    }
  }

  private buildPortals() {
    for (const p of this.region.portals) {
      const group = createPortalModel(p.label);
      group.position.set(p.x * S, 0, p.y * S);
      this.scene.add(group);
      const ring = group.children.find((c) => c.userData.portalRing) as THREE.Mesh;
      const glow = group.children.find((c) => c.userData.portalGlow) as THREE.Object3D;
      this.portals.push({ def: p, group, ring, glow, unlocked: true });
    }
  }

  private buildNodes(goneNodes: Set<string>) {
    for (const def of this.region.nodes) {
      const group = createNodeModel(def.item);
      group.position.set(def.x * S, 0, def.y * S);
      const alive = !goneNodes.has(def.id);
      group.visible = alive;
      this.scene.add(group);
      this.nodes.push({ def, alive, timer: 0, group });
    }
  }

  private buildChests(openedChests: Set<string>) {
    for (const def of this.region.chests) {
      const m = createChestModel();
      m.group.position.set(def.x * S, 0, def.y * S);
      const opened = openedChests.has(def.id);
      m.lid.rotation.z = opened ? -1.15 : 0;
      this.scene.add(m.group);
      this.chests.push({ def, opened, lid: m.lid, group: m.group });
      if (!opened) {
        const halo = glowSprite('#e8c86a', 1.0, 0.28);
        halo.position.y = 0.55;
        m.group.add(halo);
      }
    }
  }

  private buildShrine() {
    const s = this.region.shrine;
    if (!s) return;
    const m = createShrineModel();
    m.position.set(s.x * S, 0, s.y * S);
    this.scene.add(m);
    this.shrineGroup = m;
    const light = new THREE.PointLight(0xffcf8a, 18, 9, 2);
    light.position.set(s.x * S, 2, s.y * S);
    this.scene.add(light);
    this.extraLights.push(light);
  }

  setPortalUnlocked(def: PortalDef, unlocked: boolean) {
    const p = this.portals.find((x) => x.def === def);
    if (!p) return;
    p.unlocked = unlocked;
    const ringMat = p.ring.material as THREE.MeshBasicMaterial;
    ringMat.color.set(unlocked ? '#ffb45a' : '#5a2828');
    (p.glow as THREE.Sprite).material.color.set(unlocked ? '#ffb45a' : '#7a2a22');
  }

  setNodeVisible(node: RuntimeNode, visible: boolean) {
    node.alive = visible;
    node.group.visible = visible;
  }

  openChest(chest: RuntimeChest) {
    chest.opened = true;
  }

  collide(x: number, y: number, r: number) {
    const reg = this.region;
    let px = clamp(x, r, reg.w - r);
    let py = clamp(y, r, reg.h - r);
    for (let pass = 0; pass < 2; pass++) {
      for (const s of this.solids) {
        const nx = clamp(px, s.x, s.x + s.w);
        const ny = clamp(py, s.y, s.y + s.h);
        let dx = px - nx;
        let dy = py - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = r - d;
          px += (dx / d) * push;
          py += (dy / d) * push;
        } else {
          const left = px - s.x;
          const right = s.x + s.w - px;
          const top = py - s.y;
          const bottom = s.y + s.h - py;
          const min = Math.min(left, right, top, bottom);
          if (min === left) px = s.x - r;
          else if (min === right) px = s.x + s.w + r;
          else if (min === top) py = s.y - r;
          else py = s.y + s.h + r;
        }
      }
      px = clamp(px, r, reg.w - r);
      py = clamp(py, r, reg.h - r);
    }
    return { x: px, y: py };
  }

  pointBlocked(x: number, y: number) {
    for (const s of this.solids) {
      if (x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h) return true;
    }
    return false;
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    for (const p of this.portals) {
      p.ring.rotation.z = t * 0.4;
      const s = 1 + Math.sin(t * 2 + p.def.x) * 0.04;
      p.ring.scale.setScalar(s);
      const mat = p.ring.material as THREE.MeshBasicMaterial;
      mat.opacity = p.unlocked ? 0.35 + Math.sin(t * 2.4) * 0.14 : 0.18;
      (p.glow as THREE.Sprite).material.opacity = p.unlocked ? 0.26 + Math.sin(t * 2) * 0.08 : 0.12;
    }
    for (const n of this.nodes) {
      if (!n.alive) continue;
      n.group.position.y = Math.sin(t * 1.8 + n.def.x * 0.01) * 0.06;
      const core = n.group.children.find((c) => c.userData.spin);
      if (core) {
        core.rotation.y = t * 1.6;
        core.rotation.x = t * 0.9;
      }
    }
    for (const c of this.chests) {
      if (!c.opened) continue;
      if (c.lid.rotation.z > -1.15) {
        c.lid.rotation.z = Math.max(-1.15, c.lid.rotation.z - dt * 4.5);
      }
    }
    if (this.shrineGroup) {
      this.shrineGroup.rotation.y = Math.sin(t * 0.6) * 0.03;
    }
    for (let i = 0; i < this.extraLights.length; i++) {
      const l = this.extraLights[i];
      l.intensity = (l.userData.base ?? (l.userData.base = l.intensity)) * (0.86 + Math.sin(t * 7 + i * 1.7) * 0.14);
    }
  }

  dispose() {
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && !(obj instanceof THREE.Sprite)) mesh.geometry.dispose();
      const mat = (mesh as THREE.Mesh).material;
      if (mat) {
        const list = Array.isArray(mat) ? mat : [mat];
        for (const m of list) m.dispose();
      }
    });
    if (this.groundTex) this.groundTex.dispose();
    this.scene.clear();
    this.solids.length = 0;
    this.nodes.length = 0;
    this.chests.length = 0;
    this.portals.length = 0;
    this.extraLights.length = 0;
  }
}

export function addNpcTag(group: THREE.Group, npc: NpcDef) {
  const sp = glowSprite(npc.color, 0.3, 0.6);
  sp.position.y = 2;
  group.add(sp);
}
