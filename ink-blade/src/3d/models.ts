import * as THREE from 'three';
import type { PropKind } from '../types';

export const S = 1 / 32;

const glowCanvas = (() => {
  let tex: THREE.Texture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.shared = true;
    return tex;
  };
})();

export interface MatOpts {
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  rough?: number;
  metal?: number;
  flat?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
}

export function M(color: THREE.ColorRepresentation, o: MatOpts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: o.rough ?? 0.86,
    metalness: o.metal ?? 0.04,
    flatShading: o.flat ?? true,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
}

export function glowSprite(color: THREE.ColorRepresentation, size = 1, opacity = 1) {
  const mat = new THREE.SpriteMaterial({
    map: glowCanvas(),
    color,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.setScalar(size);
  return sp;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(rt: number, rb: number, h: number, mat: THREE.Material, seg = 7, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}

function shadow(radius: number, opacity = 0.34) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  return m;
}

/* ----------------------------- 玩家 ----------------------------- */
export interface PlayerModel {
  group: THREE.Group;
  spin: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  swordPivot: THREE.Group;
  torso: THREE.Group;
  head: THREE.Object3D;
  hat: THREE.Object3D;
  aura: THREE.Mesh;
  bladeWheel: THREE.Group;
  cape: THREE.Object3D;
}

export function createPlayerModel(): PlayerModel {
  const group = new THREE.Group();
  group.add(shadow(0.55));
  const spin = new THREE.Group();
  group.add(spin);

  // 跟随角色的冷色补光，避免角色在夜色中糊成一团黑影
  const rim = new THREE.PointLight(0x9fc4ff, 7, 7, 2);
  rim.position.set(-1.1, 2.1, 0.4);
  group.add(rim);

  const cloth = M('#252b38');
  const clothLight = M('#323a4c');
  const trim = M('#9c3039', { rough: 0.7 });
  const skin = M('#d8b28c', { rough: 0.8 });
  const dark = M('#181b23');
  const steel = M('#dce6f2', { metal: 0.75, rough: 0.3, flat: false });

  const legL = new THREE.Group();
  legL.position.set(0, 0.8, 0.14);
  legL.add(box(0.17, 0.74, 0.19, dark, 0, -0.37, 0));
  const legR = new THREE.Group();
  legR.position.set(0, 0.8, -0.14);
  legR.add(box(0.17, 0.74, 0.19, dark, 0, -0.37, 0));
  spin.add(legL, legR);

  const torso = new THREE.Group();
  torso.position.y = 0.8;
  const body = cyl(0.2, 0.31, 0.7, clothLight, 6, 0, 0.35, 0);
  torso.add(body);
  torso.add(box(0.42, 0.1, 0.34, trim, 0, 0.1, 0));
  torso.add(box(0.54, 0.13, 0.4, cloth, 0, 0.68, 0));
  torso.add(box(0.1, 0.5, 0.08, trim, -0.02, 0.7, 0.22));
  spin.add(torso);

  const cape = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.92, 1, 1),
    M('#1d212b', { side: THREE.DoubleSide, rough: 0.95 }),
  );
  cape.position.set(-0.3, 1.02, 0);
  cape.rotation.y = Math.PI / 2;
  cape.rotation.z = 0.08;
  spin.add(cape);

  const head = new THREE.Group();
  head.position.y = 1.56;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.175, 8, 7), skin);
  head.add(skull);
  head.add(box(0.03, 0.05, 0.2, M('#14161b'), 0.12, 0.04, 0));
  const hat = new THREE.Group();
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.06, 10), M('#3a382f', { rough: 1 }));
  brim.position.y = 0.13;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.2, 8), M('#2a2923', { rough: 1 }));
  crown.position.y = 0.25;
  hat.add(brim, crown);
  head.add(hat);
  spin.add(head);

  const armL = new THREE.Group();
  armL.position.set(0, 1.32, 0.25);
  armL.add(box(0.12, 0.5, 0.12, cloth, 0, -0.24, 0));
  const armR = new THREE.Group();
  armR.position.set(0, 1.32, -0.25);
  armR.add(box(0.12, 0.46, 0.12, clothLight, 0, -0.2, 0));
  spin.add(armL, armR);

  const swordPivot = new THREE.Group();
  swordPivot.position.set(0.04, 1.16, -0.32);
  swordPivot.rotation.y = -0.4;
  const hilt = box(0.07, 0.07, 0.2, M('#2c3038', { metal: 0.5, rough: 0.5 }), 0.02, 0, 0);
  const guard = box(0.04, 0.05, 0.22, trim, 0.09, 0, 0);
  const blade = box(1.02, 0.035, 0.055, steel, 0.6, 0, 0);
  const edge = box(1.0, 0.012, 0.02, M('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.5 }), 0.6, 0.028, 0);
  swordPivot.add(hilt, guard, blade, edge);
  spin.add(swordPivot);

  const aura = new THREE.Mesh(
    new THREE.RingGeometry(0.48, 0.62, 40),
    new THREE.MeshBasicMaterial({
      color: '#ff4d5a',
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = 0.06;
  aura.visible = false;
  group.add(aura);

  const bladeWheel = new THREE.Group();
  bladeWheel.position.y = 0.8;
  bladeWheel.visible = false;
  const bladeMat = new THREE.MeshBasicMaterial({
    color: '#9fe4ff',
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const holder = new THREE.Group();
    holder.rotation.y = -a;
    const bladeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.05), bladeMat);
    bladeMesh.position.x = 2.7;
    holder.add(bladeMesh);
    bladeWheel.add(holder);
  }
  group.add(bladeWheel);

  return { group, spin, legL, legR, armL, armR, swordPivot, torso, head, hat, aura, bladeWheel, cape };
}

/* ----------------------------- 敌人 ----------------------------- */
export interface EnemyModel {
  group: THREE.Group;
  body: THREE.Group;
  legs: THREE.Group[];
  head: THREE.Object3D;
  extra?: THREE.Object3D;
}

export function createWolfModel(elite: boolean): EnemyModel {
  const group = new THREE.Group();
  const scale = elite ? 1.32 : 1;
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  group.add(shadow(0.62 * scale));
  group.add(body);

  const fur = M(elite ? '#2e2620' : '#1d2026', { rough: 1 });
  const furLight = M(elite ? '#4a3a2a' : '#262a32', { rough: 1 });
  const dark = M('#121418', { rough: 1 });

  body.add(box(0.95, 0.42, 0.44, fur, 0, 0.62, 0));
  body.add(box(0.34, 0.36, 0.4, furLight, 0.56, 0.68, 0));
  body.add(box(0.24, 0.16, 0.22, dark, 0.8, 0.58, 0));
  // 耳朵
  for (const z of [-0.13, 0.13]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), dark);
    ear.position.set(0.5, 0.92, z);
    body.add(ear);
  }
  // 眼睛
  for (const z of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 6, 5),
      new THREE.MeshBasicMaterial({ color: '#ff4d3a' }),
    );
    eye.position.set(0.7, 0.74, z);
    body.add(eye);
  }
  const legs: THREE.Group[] = [];
  const legPos: [number, number][] = [
    [0.32, 0.17],
    [0.32, -0.17],
    [-0.34, 0.17],
    [-0.34, -0.17],
  ];
  for (const [x, z] of legPos) {
    const g = new THREE.Group();
    g.position.set(x, 0.48, z);
    g.add(box(0.13, 0.5, 0.13, dark, 0, -0.24, 0));
    body.add(g);
    legs.push(g);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.7, 5), fur);
  tail.position.set(-0.52, 0.7, 0);
  tail.rotation.z = Math.PI / 2.4;
  body.add(tail);

  if (elite) {
    const mark = glowSprite('#e0b85a', 1.4, 0.5);
    mark.position.set(0, 1.3, 0);
    body.add(mark);
  }
  return { group, body, legs, head: body.children[1] ?? body };
}

export function createGhostModel(): EnemyModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const cloth = M('#111820', { transparent: true, opacity: 0.92, side: THREE.DoubleSide, rough: 1 });
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.44, 1.25, 7, 1, true), cloth);
  robe.position.y = 0.88;
  body.add(robe);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 7),
    new THREE.MeshBasicMaterial({ color: '#55e2cf', transparent: true, opacity: 0.95 }),
  );
  core.position.y = 1.02;
  body.add(core);

  const mask = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 7), M('#e8e2d2', { rough: 0.6 }));
  mask.scale.set(1, 1.18, 0.55);
  mask.position.set(0.2, 1.32, 0);
  body.add(mask);
  for (const z of [-0.07, 0.07]) {
    body.add(box(0.03, 0.025, 0.05, M('#15171c'), 0.36, 1.35, z));
  }
  body.add(box(0.025, 0.06, 0.04, M('#8f2b33'), 0.37, 1.24, 0));

  const halo = glowSprite('#55e2cf', 1.7, 0.5);
  halo.position.y = 0.9;
  body.add(halo);
  group.add(shadow(0.4, 0.18));
  return { group, body, legs: [], head: mask, extra: core };
}

export function createMonkModel(elite: boolean): EnemyModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const scale = elite ? 1.18 : 1;
  body.scale.setScalar(scale);
  group.add(shadow(0.58 * scale));
  group.add(body);

  const robe = M(elite ? '#4a3a2a' : '#2c2a26', { rough: 1 });
  const trim = M(elite ? '#a8843e' : '#5d4432', { rough: 0.8 });
  const skin = M('#8a8070', { rough: 0.9 });

  body.add(cyl(0.24, 0.42, 1.3, robe, 7, 0, 0.68, 0));
  body.add(box(0.72, 0.12, 0.6, trim, 0, 0.9, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 7), skin);
  head.position.y = 1.48;
  body.add(head);
  body.add(box(0.34, 0.18, 0.32, M('#3a3228'), 0, 1.58, 0));
  body.add(box(0.38, 0.08, 0.1, M('#d8cdb0'), 0.14, 1.47, 0));
  // 佛珠
  const beads = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 5, 14), M('#6a4a32'));
  beads.position.y = 1.12;
  beads.rotation.x = Math.PI / 2;
  body.add(beads);
  // 禅杖
  const staff = new THREE.Group();
  staff.position.set(0.05, 0.9, -0.36);
  staff.rotation.z = -0.1;
  staff.add(cyl(0.035, 0.035, 1.9, M('#5a4632'), 5, 0, 0.1, 0));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 5, 12), M(elite ? '#e0b85a' : '#8c7a50', { metal: 0.6 }));
  ring.position.y = 1.08;
  staff.add(ring);
  body.add(staff);

  if (elite) {
    const halo = glowSprite('#e0b85a', 1.8, 0.45);
    halo.position.y = 1.1;
    body.add(halo);
  }
  return { group, body, legs: [], head };
}

/* ----------------------------- Boss ----------------------------- */
export interface BossModel {
  group: THREE.Group;
  body: THREE.Group;
  head: THREE.Object3D;
  sword: THREE.Group;
  capeL: THREE.Object3D;
  capeR: THREE.Object3D;
  aura: THREE.Mesh;
  glow: THREE.Object3D;
}

export function createBossModel(): BossModel {
  const group = new THREE.Group();
  group.add(shadow(1.15, 0.45));
  const body = new THREE.Group();
  body.scale.setScalar(1.28);
  group.add(body);

  const armor = M('#1e1d24', { rough: 0.7, metal: 0.25 });
  const armor2 = M('#2b2a33', { rough: 0.7, metal: 0.2 });
  const red = M('#8f2b33', { emissive: '#4a0d10', emissiveIntensity: 0.8 });
  const skin = M('#c8b49a', { rough: 0.8 });

  body.add(cyl(0.34, 0.52, 1.15, armor, 7, 0, 0.72, 0));
  body.add(box(0.95, 0.18, 0.62, armor2, 0, 1.28, 0));
  body.add(box(0.66, 0.08, 0.5, red, 0, 1.02, 0));
  // 肩甲
  for (const z of [-0.42, 0.42]) {
    const pad = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.34, 4), armor2);
    pad.position.set(0, 1.36, z);
    pad.rotation.z = Math.PI;
    body.add(pad);
  }
  // 头与面具
  const head = new THREE.Group();
  head.position.y = 1.62;
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.23, 8, 7), skin));
  const mask = new THREE.Mesh(new THREE.SphereGeometry(0.235, 8, 7), M('#e9e4d6', { rough: 0.5 }));
  mask.scale.set(0.86, 1, 0.7);
  mask.position.x = 0.12;
  head.add(mask);
  for (const z of [-0.08, 0.08]) head.add(box(0.05, 0.03, 0.06, M('#121014'), 0.31, 0.03, z));
  head.add(box(0.03, 0.09, 0.05, red, 0.32, -0.09, 0));
  // 角
  for (const z of [-0.13, 0.13]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.34, 4), M('#c9bfa8'));
    horn.position.set(0.02, 0.28, z);
    horn.rotation.z = -0.45;
    horn.rotation.x = z > 0 ? 0.3 : -0.3;
    head.add(horn);
  }
  body.add(head);

  // 披风
  const capeMat = M('#141318', { side: THREE.DoubleSide, rough: 1 });
  const capeL = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.55), capeMat);
  capeL.position.set(-0.34, 0.86, 0.34);
  capeL.rotation.y = Math.PI / 2;
  capeL.rotation.z = 0.14;
  const capeR = capeL.clone();
  capeR.position.z = -0.34;
  capeR.rotation.z = -0.14;
  body.add(capeL, capeR);

  // 巨剑
  const sword = new THREE.Group();
  sword.position.set(0.1, 1.05, -0.55);
  sword.rotation.y = -0.35;
  sword.add(box(0.1, 0.1, 0.28, M('#2c3038', { metal: 0.5 }), 0.02, 0, 0));
  sword.add(box(0.06, 0.07, 0.3, red, 0.1, 0, 0));
  sword.add(box(1.55, 0.06, 0.1, M('#c9ccd4', { metal: 0.85, rough: 0.28, flat: false }), 0.86, 0, 0));
  sword.add(box(1.5, 0.02, 0.03, M('#ff6a4a', { emissive: '#ff3a2a', emissiveIntensity: 1.6 }), 0.86, 0.045, 0));
  body.add(sword);

  const aura = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.16, 48),
    new THREE.MeshBasicMaterial({
      color: '#ff4a3a',
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = 0.06;
  group.add(aura);

  const glow = glowSprite('#ff3a2a', 3.4, 0.35);
  glow.position.y = 1.4;
  group.add(glow);

  return { group, body, head, sword, capeL, capeR, aura, glow };
}

/* ----------------------------- NPC ----------------------------- */
export function createNpcModel(color: string) {
  const group = new THREE.Group();
  group.add(shadow(0.48));
  const body = new THREE.Group();
  group.add(body);
  const cloth = M(color, { rough: 1 });
  const light = M(new THREE.Color(color).offsetHSL(0, -0.05, 0.08).getStyle(), { rough: 1 });
  body.add(cyl(0.22, 0.4, 1.15, cloth, 7, 0, 0.62, 0));
  body.add(box(0.55, 0.1, 0.42, light, 0, 0.92, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 7), M('#d8b28c'));
  head.position.y = 1.38;
  body.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.06, 10), M('#2a2923'));
  hat.position.y = 1.51;
  body.add(hat);
  body.add(cyl(0.12, 0.16, 0.14, M('#2a2923'), 8, 0, 1.58, 0));
  const glow = glowSprite('#ffcf8a', 0.7, 0.18);
  glow.position.y = 1.4;
  body.add(glow);
  return { group, body, head };
}

/* ----------------------------- 场景道具 ----------------------------- */
export function createPropModel(kind: PropKind, scale = 1, variant = 0, w = 0, h = 0): THREE.Group {
  const g = new THREE.Group();
  const v = variant % 4;

  switch (kind) {
    case 'tree': {
      const trunk = cyl(0.14, 0.24, 1.9 + v * 0.18, M('#2a211c', { rough: 1 }), 6, 0, (1.9 + v * 0.18) / 2, 0);
      g.add(trunk);
      const leafColors = ['#16241d', '#1b2c22', '#202f25', '#132019'];
      for (let i = 0; i < 3; i++) {
        const r = (1.05 - i * 0.22) * (0.9 + (v % 2) * 0.16);
        const leaf = new THREE.Mesh(
          new THREE.IcosahedronGeometry(r, 0),
          M(leafColors[(v + i) % leafColors.length], { rough: 1 }),
        );
        leaf.position.set(Math.cos(i * 2.1) * 0.18, 1.95 + i * 0.62, Math.sin(i * 2.1) * 0.18);
        leaf.scale.y = 0.82;
        g.add(leaf);
      }
      break;
    }
    case 'deadwood': {
      const trunk = cyl(0.1, 0.22, 2.5, M('#2b2520', { rough: 1 }), 5, 0, 1.25, 0);
      trunk.rotation.z = 0.06;
      g.add(trunk);
      for (let i = 0; i < 3; i++) {
        const br = cyl(0.04, 0.09, 0.9, M('#2b2520', { rough: 1 }), 4, 0, 1.4 + i * 0.4, 0);
        br.rotation.z = 0.75 + i * 0.15;
        br.rotation.y = i * 2.1;
        br.position.x = Math.cos(i * 2.1) * 0.35;
        br.position.z = Math.sin(i * 2.1) * 0.35;
        g.add(br);
      }
      break;
    }
    case 'rock':
    case 'boulder': {
      const size = kind === 'boulder' ? 1.25 : 0.72;
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(size * (0.8 + v * 0.08), 0),
        M(['#2b2b2e', '#323236', '#25262a', '#35322f'][v], { rough: 1 }),
      );
      rock.position.y = size * 0.62;
      rock.scale.set(1.15, 0.78, 1);
      rock.rotation.y = v;
      g.add(rock);
      break;
    }
    case 'lantern': {
      g.add(cyl(0.04, 0.05, 1.55, M('#2b2520'), 5, 0, 0.78, 0));
      const lamp = box(0.28, 0.4, 0.28, M('#3a2f24', { emissive: '#ffb45a', emissiveIntensity: 0.55 }), 0, 1.68, 0);
      g.add(lamp);
      const halo = glowSprite('#ffb45a', 1.25, 0.55);
      halo.position.y = 1.68;
      g.add(halo);
      break;
    }
    case 'torch': {
      g.add(cyl(0.035, 0.045, 1.3, M('#30261f'), 5, 0, 0.65, 0));
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.34, 6),
        new THREE.MeshBasicMaterial({ color: '#ffb45a' }),
      );
      flame.position.y = 1.45;
      g.add(flame);
      const halo = glowSprite('#ff9a4a', 1.5, 0.7);
      halo.position.y = 1.45;
      g.add(halo);
      break;
    }
    case 'bamboo': {
      for (let i = 0; i < 4; i++) {
        const hgt = 2.2 + (i % 3) * 0.45;
        const st = cyl(0.035, 0.05, hgt, M('#2e4a34', { rough: 1 }), 5, Math.cos(i * 1.7) * 0.28, hgt / 2, Math.sin(i * 1.7) * 0.28);
        st.rotation.z = Math.sin(i * 2.3) * 0.08;
        g.add(st);
        for (let k = 0; k < 2; k++) {
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 4), M('#33543a', { rough: 1 }));
          leaf.position.set(st.position.x + (k ? 0.15 : -0.15), hgt * 0.62 + k * 0.5, st.position.z);
          leaf.rotation.z = k ? 1.2 : -1.2;
          g.add(leaf);
        }
      }
      break;
    }
    case 'grass': {
      for (let i = 0; i < 5; i++) {
        const bl = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.36 + v * 0.03, 3), M('#26382b', { rough: 1 }));
        bl.position.set(Math.cos(i * 1.9) * 0.22, 0.18, Math.sin(i * 1.9) * 0.22);
        bl.rotation.z = Math.cos(i * 1.9) * 0.35;
        g.add(bl);
      }
      break;
    }
    case 'statue': {
      g.add(box(0.9, 0.3, 0.9, M('#2f3035'), 0, 0.15, 0));
      g.add(box(0.55, 0.5, 0.55, M('#3a3b40'), 0, 0.55, 0));
      g.add(cyl(0.2, 0.3, 0.9, M('#45464c'), 7, 0, 1.2, 0));
      const hd = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 6), M('#4d4e54'));
      hd.position.y = 1.8;
      g.add(hd);
      g.add(glowSprite('#7fd8ff', 0.8, 0.16));
      break;
    }
    case 'pillar': {
      g.add(box(0.5, 0.24, 0.5, M('#33343a'), 0, 0.12, 0));
      g.add(cyl(0.17, 0.21, 2.3, M('#3d3e45'), 6, 0, 1.38, 0));
      g.add(box(0.5, 0.18, 0.5, M('#2b2c31'), 0, 2.55, 0));
      break;
    }
    case 'banner': {
      g.add(cyl(0.035, 0.045, 2.2, M('#2b2520'), 5, 0, 1.1, 0));
      const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(0.52, 1.15),
        M('#7a2226', { side: THREE.DoubleSide, rough: 1, emissive: '#2a0708', emissiveIntensity: 0.4 }),
      );
      cloth.position.set(0.28, 1.55, 0);
      cloth.rotation.y = Math.PI / 2;
      g.add(cloth);
      break;
    }
    case 'well': {
      g.add(cyl(0.72, 0.78, 0.7, M('#33343a'), 10, 0, 0.35, 0));
      g.add(cyl(0.58, 0.58, 0.72, M('#10151c'), 10, 0, 0.38, 0));
      g.add(cyl(0.08, 0.1, 1.5, M('#2b2520'), 5, 0.55, 1.3, 0));
      g.add(cyl(0.08, 0.1, 1.5, M('#2b2520'), 5, -0.55, 1.3, 0));
      g.add(box(1.4, 0.1, 0.3, M('#2b2520'), 0, 2.05, 0));
      break;
    }
    case 'stall': {
      const ww = w ? w * S : 3.6;
      const dd = h ? h * S : 1.6;
      g.add(box(ww, 0.9, dd, M('#3a2c22'), 0, 0.45, 0));
      g.add(box(ww * 0.95, 0.08, dd * 1.05, M('#5a4030'), 0, 0.92, 0));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(ww * 0.7, 0.5, 4), M('#5e2a28', { rough: 1 }));
      roof.position.y = 2.1;
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = dd / ww;
      g.add(roof);
      for (const x of [-ww * 0.45, ww * 0.45]) {
        for (const z of [-dd * 0.45, dd * 0.45]) g.add(cyl(0.05, 0.05, 1.7, M('#2b211a'), 4, x, 1.05, z));
      }
      break;
    }
    case 'bones': {
      const boneMat = M('#cfc6ad', { rough: 0.95 });
      for (let i = 0; i < 6; i++) {
        const b = box(0.1 + (i % 3) * 0.08, 0.06, 0.06, boneMat, Math.cos(i * 1.6) * 0.36, 0.05, Math.sin(i * 1.6) * 0.3);
        b.rotation.y = i * 0.9;
        g.add(b);
      }
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), boneMat);
      skull.position.set(0.18, 0.12, 0.12);
      skull.scale.y = 0.75;
      g.add(skull);
      break;
    }
    case 'shrine': {
      g.add(box(0.8, 0.22, 0.8, M('#33343a'), 0, 0.11, 0));
      g.add(box(0.52, 0.7, 0.52, M('#3d3e45'), 0, 0.55, 0));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.3, 4), M('#2b2c31'));
      roof.position.y = 1.05;
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
      const light = box(0.18, 0.2, 0.18, M('#ffcf8a', { emissive: '#ffae4a', emissiveIntensity: 1.4 }), 0, 0.72, 0.3);
      g.add(light);
      const halo = glowSprite('#ffcf8a', 0.9, 0.4);
      halo.position.set(0, 0.75, 0.3);
      g.add(halo);
      break;
    }
    case 'censer': {
      g.add(cyl(0.32, 0.4, 0.5, M('#3b3c42'), 8, 0, 0.45, 0));
      g.add(cyl(0.06, 0.06, 0.45, M('#2b2c31'), 5, 0, 0.12, 0));
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 5), new THREE.MeshBasicMaterial({ color: '#ff9a4a' }));
      flame.position.y = 0.86;
      g.add(flame);
      const halo = glowSprite('#ff9a4a', 1.1, 0.5);
      halo.position.y = 0.88;
      g.add(halo);
      break;
    }
    case 'brazier': {
      g.add(cyl(0.3, 0.42, 0.45, M('#33343a'), 8, 0, 0.36, 0));
      g.add(cyl(0.05, 0.05, 0.3, M('#2b2c31'), 4, 0, 0.12, 0));
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 6), new THREE.MeshBasicMaterial({ color: '#ff7a3a' }));
      flame.position.y = 0.85;
      g.add(flame);
      const halo = glowSprite('#ff7a3a', 1.7, 0.65);
      halo.position.y = 0.88;
      g.add(halo);
      break;
    }
    case 'gate': {
      const gateW = w ? w * S : 4.6;
      for (const x of [-gateW / 2, gateW / 2]) {
        g.add(cyl(0.16, 0.2, 3.1, M('#4a1e20'), 6, x, 1.55, 0));
      }
      g.add(box(gateW + 0.7, 0.22, 0.28, M('#5a2426'), 0, 2.95, 0));
      g.add(box(gateW + 0.2, 0.16, 0.2, M('#3a1618'), 0, 2.6, 0));
      const halo = glowSprite('#ff7a4a', gateW * 0.8, 0.22);
      halo.position.y = 2.2;
      g.add(halo);
      break;
    }
    case 'fence': {
      const len = 3.6;
      for (let i = 0; i <= 4; i++) g.add(box(0.08, 0.9, 0.08, M('#33291f'), -len / 2 + (i / 4) * len, 0.45, 0));
      g.add(box(len, 0.08, 0.06, M('#3f3326'), 0, 0.68, 0));
      g.add(box(len, 0.08, 0.06, M('#3f3326'), 0, 0.36, 0));
      break;
    }
    case 'house': {
      const ww = w ? w * S : 7;
      const dd = h ? h * S : 4.4;
      const wall = M(['#26262b', '#2a2622', '#252a2c', '#2c2724'][v], { rough: 1 });
      g.add(box(ww, 2.5, dd, wall, 0, 1.25, 0));
      g.add(box(ww * 0.99, 0.16, dd * 0.99, M('#3a2c22'), 0, 2.56, 0));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(ww * 0.78, 1.5, 4), M(['#1c2026', '#241f1c', '#202528', '#231f22'][v], { rough: 1 }));
      roof.position.y = 3.35;
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = (dd * 1.22) / (ww * 1.1);
      g.add(roof);
      // 窗与灯
      for (const x of [-ww * 0.26, ww * 0.26]) {
        const win = box(0.5, 0.55, 0.04, M('#ffb45a', { emissive: '#ff9a3a', emissiveIntensity: 1.15 }), x, 1.5, dd / 2 + 0.02);
        g.add(win);
        const halo = glowSprite('#ffb45a', 1.0, 0.32);
        halo.position.set(x, 1.5, dd / 2 + 0.15);
        g.add(halo);
      }
      g.add(box(0.9, 1.45, 0.08, M('#181410'), 0, 0.73, dd / 2 + 0.03));
      break;
    }
    default: {
      const d = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0), M('#2b2b2e'));
      d.position.y = 0.6;
      g.add(d);
    }
  }

  g.scale.setScalar(scale);
  return g;
}

/* ----------------------------- 交互物 ----------------------------- */
export function createNodeModel(item: string): THREE.Group {
  const g = new THREE.Group();
  if (item === 'ghostfire') {
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 0),
      new THREE.MeshBasicMaterial({ color: '#63e8d6' }),
    );
    core.position.y = 0.55;
    core.userData.spin = true;
    g.add(core);
    const halo = glowSprite('#63e8d6', 1.35, 0.7);
    halo.position.y = 0.55;
    g.add(halo);
    for (let i = 0; i < 3; i++) {
      const wisp = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 4), new THREE.MeshBasicMaterial({ color: '#a8fff4' }));
      wisp.position.set(Math.cos(i * 2.1) * 0.22, 0.3 + i * 0.14, Math.sin(i * 2.1) * 0.22);
      g.add(wisp);
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.52, 4), M('#4d9c63', { emissive: '#123a20', emissiveIntensity: 0.5 }));
      leaf.position.set(Math.cos(i * 1.5) * 0.14, 0.26, Math.sin(i * 1.5) * 0.14);
      leaf.rotation.z = Math.cos(i * 1.5) * 0.5;
      leaf.rotation.x = Math.sin(i * 1.5) * 0.5;
      g.add(leaf);
    }
    const halo = glowSprite('#7ad08e', 0.75, 0.35);
    halo.position.y = 0.45;
    g.add(halo);
  }
  return g;
}

export interface ChestModel {
  group: THREE.Group;
  lid: THREE.Group;
}

export function createChestModel(): ChestModel {
  const g = new THREE.Group();
  const wood = M('#3a2a1e', { rough: 0.95 });
  const gold = M('#b08a3e', { metal: 0.65, rough: 0.4, emissive: '#2a1c06', emissiveIntensity: 0.6 });
  g.add(box(0.78, 0.44, 0.56, wood, 0, 0.22, 0));
  for (const z of [-0.28, 0.28]) g.add(box(0.82, 0.08, 0.04, gold, 0, 0.24, z));
  const lid = new THREE.Group();
  lid.position.set(-0.39, 0.44, 0);
  const lidMesh = box(0.78, 0.12, 0.56, wood, 0.39, 0.06, 0);
  lid.add(lidMesh);
  lid.add(box(0.82, 0.05, 0.05, gold, 0.39, 0.1, 0.28));
  g.add(lid);
  g.add(box(0.12, 0.14, 0.06, gold, 0, 0.36, 0.29));
  const halo = glowSprite('#e8c86a', 1.0, 0.28);
  halo.position.y = 0.55;
  g.add(halo);
  return { group: g, lid };
}

export function createShrineModel(): THREE.Group {
  const g = new THREE.Group();
  const stone = M('#3b3c42', { rough: 1 });
  g.add(box(1.1, 0.28, 1.1, stone, 0, 0.14, 0));
  g.add(cyl(0.26, 0.34, 0.9, stone, 7, 0, 0.7, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.42, 4), M('#2b2c31'));
  roof.position.y = 1.34;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 6), new THREE.MeshBasicMaterial({ color: '#ffcf8a' }));
  flame.position.y = 1.66;
  g.add(flame);
  const halo = glowSprite('#ffcf8a', 2.2, 0.5);
  halo.position.y = 1.7;
  g.add(halo);
  return g;
}

export function createPortalModel(label: string): THREE.Group {
  const g = new THREE.Group();
  const red = M('#5a2426', { rough: 0.85 });
  const dark = M('#2b2520', { rough: 1 });
  const span = 3.4;
  for (const x of [-span / 2, span / 2]) {
    g.add(cyl(0.15, 0.19, 3.4, red, 6, x, 1.7, 0));
    g.add(cyl(0.1, 0.1, 0.5, dark, 5, x, 0.25, 0));
  }
  g.add(box(span + 0.9, 0.24, 0.32, red, 0, 3.35, 0));
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.42),
    new THREE.MeshBasicMaterial({ color: '#0f1115', side: THREE.DoubleSide }),
  );
  plaque.position.set(0, 3.05, 0);
  g.add(plaque);

  const ringMat = new THREE.MeshBasicMaterial({
    color: '#ffb45a',
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.22, 40), ringMat);
  ring.position.set(0, 1.85, 0);
  ring.userData.portalRing = true;
  g.add(ring);
  const halo = glowSprite('#ffb45a', 3.0, 0.35);
  halo.position.y = 1.85;
  halo.userData.portalGlow = true;
  g.add(halo);
  g.userData.label = label;
  return g;
}

export function createPickupModel(item: string | undefined, money: number): THREE.Group {
  const g = new THREE.Group();
  if (item) {
    const colors: Record<string, string> = {
      pill_heal: '#d95a4c',
      pill_chi: '#6aa7e8',
      pill_speed: '#8ed6a2',
      pill_guard: '#e3c073',
      herb: '#6fc98a',
      bloodsand: '#c2483f',
      bone: '#e6ddc4',
      ghostfire: '#55e2cf',
      key: '#c9a34f',
      talisman: '#b3382f',
    };
    const color = colors[item] ?? '#e8c86a';
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), new THREE.MeshBasicMaterial({ color }));
    core.position.y = 0.16;
    g.add(core);
    const halo = glowSprite(color, 0.7, 0.8);
    halo.position.y = 0.16;
    g.add(halo);
  } else {
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 10), M('#e8c86a', { metal: 0.8, rough: 0.35, emissive: '#3a2a06', emissiveIntensity: 0.8 }));
    coin.position.y = 0.15;
    coin.rotation.x = Math.PI / 2;
    g.add(coin);
    const halo = glowSprite('#e8c86a', 0.6, 0.7);
    halo.position.y = 0.15;
    g.add(halo);
  }
  g.userData.money = money;
  return g;
}

/* ----------------------------- 工具 ----------------------------- */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && !(obj instanceof THREE.Sprite)) mesh.geometry.dispose();
    const mat = (mesh as THREE.Mesh).material;
    const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const m of list) m.dispose();
  });
}
