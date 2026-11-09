import * as THREE from 'three';
import { S } from './models';

interface BurstOpts {
  count?: number;
  color?: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  speed?: number;
  size?: number;
  life?: number;
  grav?: number;
  angle?: number;
  spread?: number;
  drag?: number;
  shape?: string;
  glow?: boolean;
  y?: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
  grav: number;
  drag: number;
}

interface Effect {
  obj: THREE.Object3D;
  t: number;
  max: number;
  update: (obj: THREE.Object3D, k: number, dt: number) => void;
}

const MAX_PARTICLES = 2600;
const textCache = new Map<string, THREE.Texture>();

function textTexture(text: string, color: string, size: number) {
  const key = `${text}|${color}|${size}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 96);
  ctx.font = `bold ${Math.round(46 + size)}px "Noto Serif SC","Songti SC",serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 50);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  textCache.set(key, tex);
  return tex;
}

export class Fx3D {
  root = new THREE.Group();
  private parts: Particle[] = [];
  private points: THREE.Points;
  private posAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private effects: Effect[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.root);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colorAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vC;
        varying float vA;
        void main() {
          vC = aColor;
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * (165.0 / max(0.5, -mv.z)), 1.0, 44.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vC;
        varying float vA;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vC, a * vA);
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.root.add(this.points);
  }

  /* ------------------------------ 粒子 ------------------------------ */
  burst(px: number, py: number, o: BurstOpts = {}) {
    const count = Math.min(o.count ?? 12, 220);
    const c1 = new THREE.Color(o.color ?? '#ff8a5a');
    const c2 = new THREE.Color(o.color2 ?? o.color ?? '#fff0c8');
    const ang = o.angle ?? Math.random() * Math.PI * 2;
    const spread = o.spread ?? Math.PI * 2;
    for (let i = 0; i < count; i++) {
      if (this.parts.length >= MAX_PARTICLES) break;
      const a = ang + (Math.random() - 0.5) * spread;
      const sp = (o.speed ?? 120) * (0.35 + Math.random() * 0.9);
      const life = (o.life ?? 0.6) * (0.65 + Math.random() * 0.7);
      this.parts.push({
        x: px * S,
        y: o.y ?? 0.6,
        z: py * S,
        vx: Math.cos(a) * sp * S,
        vy: (Math.random() * 0.6 + 0.1) * (o.grav && o.grav > 0 ? 0.3 : 1.4),
        vz: Math.sin(a) * sp * S,
        life,
        max: life,
        size: (o.size ?? 2.4) * (0.75 + Math.random() * 0.65),
        color: c1.clone().lerp(c2, Math.random()),
        grav: (o.grav ?? -40) * S,
        drag: o.drag ?? 1.6,
      });
    }
  }

  embers(px: number, py: number, count = 8, color: THREE.ColorRepresentation = '#ff8a4a') {
    for (let i = 0; i < count; i++) {
      if (this.parts.length >= MAX_PARTICLES) break;
      const life = 0.5 + Math.random() * 0.8;
      this.parts.push({
        x: (px + (Math.random() - 0.5) * 30) * S,
        y: 0.15 + Math.random() * 0.9,
        z: (py + (Math.random() - 0.5) * 30) * S,
        vx: (Math.random() - 0.5) * 0.9,
        vy: 0.8 + Math.random() * 1.6,
        vz: (Math.random() - 0.5) * 0.9,
        life,
        max: life,
        size: 0.75 + Math.random() * 1.0,
        color: new THREE.Color(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12),
        grav: 0.6,
        drag: 0.8,
      });
    }
  }

  /* ------------------------------ 刀光 ------------------------------ */
  slash(px: number, py: number, angle: number, range: number, color: THREE.ColorRepresentation, halfArc = 1.2, width = 8, life = 0.4) {
    const radius = Math.max(0.4, range * S);
    const inner = Math.max(0.05, radius - width * S * 2.2);
    const geo = new THREE.RingGeometry(inner, radius, 28, 1, -halfArc, halfArc * 2);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px * S, 0.72, py * S);
    mesh.rotation.y = -angle;
    this.root.add(mesh);
    this.effects.push({
      obj: mesh,
      t: 0,
      max: life,
      update: (obj, k) => {
        obj.scale.setScalar(0.72 + k * 0.4);
        obj.position.y = 0.72 + k * 0.28;
        (obj as THREE.Mesh).rotation.y = -angle + k * 0.16;
        mat.opacity = 0.95 * (1 - k) ** 1.4;
      },
    });
  }

  ring(px: number, py: number, r0: number, r1: number, color: THREE.ColorRepresentation, width = 4, life = 0.5) {
    const geo = new THREE.RingGeometry(0.93, 1, 56);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px * S, 0.08, py * S);
    mesh.scale.setScalar(Math.max(0.08, r0 * S));
    this.root.add(mesh);
    this.effects.push({
      obj: mesh,
      t: 0,
      max: life,
      update: (obj, k) => {
        const r = (r0 + (r1 - r0) * (1 - (1 - k) ** 2)) * S;
        obj.scale.setScalar(r);
        mat.opacity = 0.9 * (1 - k) * Math.min(1, 0.3 + width * 0.1);
      },
    });
  }

  rune(px: number, py: number, radius: number, color: THREE.ColorRepresentation, life = 0.8) {
    const group = new THREE.Group();
    group.position.set(px * S, 0.06, py * S);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const geo = new THREE.RingGeometry(0.9, 1, 48);
    geo.rotateX(-Math.PI / 2);
    const r1 = new THREE.Mesh(geo, mat);
    r1.scale.setScalar(radius * S);
    const r2 = new THREE.Mesh(geo, mat.clone());
    r2.scale.setScalar(radius * S * 0.68);
    group.add(r1, r2);
    const tickMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tickGeo = new THREE.BoxGeometry(0.04, 0.01, 0.24);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const t = new THREE.Mesh(tickGeo, tickMat);
      t.position.set(Math.cos(a) * radius * S * 0.86, 0.02, Math.sin(a) * radius * S * 0.86);
      t.rotation.y = -a;
      group.add(t);
    }
    this.root.add(group);
    const mats = [mat, r2.material as THREE.MeshBasicMaterial, tickMat];
    this.effects.push({
      obj: group,
      t: 0,
      max: life,
      update: (obj, k) => {
        obj.rotation.y = k * 2.2;
        obj.scale.setScalar(0.8 + k * 0.35);
        for (const m of mats) m.opacity = (0.85 - k * 0.8) * (1 - k * 0.2);
      },
    });
  }

  ghost(px: number, py: number, facing: number, color: THREE.ColorRepresentation) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 1.1, 6), mat);
    body.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), mat);
    head.position.y = 1.5;
    group.add(body, head);
    group.position.set(px * S, 0, py * S);
    group.rotation.y = -facing;
    group.scale.y = 0.7;
    this.root.add(group);
    this.effects.push({
      obj: group,
      t: 0,
      max: 0.34,
      update: (obj, k) => {
        mat.opacity = 0.45 * (1 - k);
        obj.scale.set(1 - k * 0.25, 0.7 - k * 0.3, 1 - k * 0.25);
      },
    });
  }

  text(px: number, py: number, text: string, color = '#ffffff', size = 16) {
    const tex = textTexture(text, color, size);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const sp = new THREE.Sprite(mat);
    const scale = 0.9 + size * 0.05;
    sp.scale.set(scale * 2.6, scale * 0.98, 1);
    sp.position.set((px + (Math.random() - 0.5) * 16) * S, 1.85, py * S);
    sp.renderOrder = 20;
    this.root.add(sp);
    this.effects.push({
      obj: sp,
      t: 0,
      max: 0.85,
      update: (obj, k) => {
        obj.position.y = 1.85 + k * 1.15;
        mat.opacity = 1 - k ** 2;
        const s = 1 + k * 0.25;
        sp.scale.set(scale * 2.6 * s, scale * 0.98 * s, 1);
      },
    });
  }

  /* ------------------------------ 更新 ------------------------------ */
  update(dt: number) {
    let n = 0;
    const pos = this.posAttr.array as Float32Array;
    const col = this.colorAttr.array as Float32Array;
    const siz = this.sizeAttr.array as Float32Array;
    const alp = this.alphaAttr.array as Float32Array;

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy -= p.grav * dt;
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.03) {
        p.y = 0.03;
        p.vy = Math.abs(p.vy) * 0.25;
      }
    }

    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (n >= MAX_PARTICLES) break;
      const k = p.life / p.max;
      pos[n * 3] = p.x;
      pos[n * 3 + 1] = p.y;
      pos[n * 3 + 2] = p.z;
      col[n * 3] = p.color.r;
      col[n * 3 + 1] = p.color.g;
      col[n * 3 + 2] = p.color.b;
      siz[n] = p.size * (0.6 + k * 0.6);
      alp[n] = Math.min(1, k * 1.8);
      n++;
    }
    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, n);

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      const k = Math.min(1, e.t / e.max);
      e.update(e.obj, k, dt);
      if (e.t >= e.max) {
        this.root.remove(e.obj);
        e.obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry && !(o instanceof THREE.Sprite)) mesh.geometry.dispose();
          const mat = (mesh as THREE.Mesh).material;
          if (mat) {
            const list = Array.isArray(mat) ? mat : [mat];
            for (const m of list) {
              const sm = m as THREE.SpriteMaterial;
              if (sm.map && !sm.map.userData.shared) sm.map.dispose();
              m.dispose();
            }
          }
        });
        this.effects.splice(i, 1);
      }
    }
  }

  clear() {
    this.parts.length = 0;
    for (const e of this.effects) {
      this.root.remove(e.obj);
      e.obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry && !(o instanceof THREE.Sprite)) mesh.geometry.dispose();
        const mat = (mesh as THREE.Mesh).material;
        if (mat) {
          const list = Array.isArray(mat) ? mat : [mat];
          for (const m of list) m.dispose();
        }
      });
    }
    this.effects.length = 0;
  }

  dispose() {
    this.clear();
    this.parts.length = 0;
    this.root.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
