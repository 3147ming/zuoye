import type { NpcDef, PropDef, RegionDef, RegionId } from '../types';
import { mulberry32 } from '../core/utils';

interface Avoid {
  x: number;
  y: number;
  r: number;
}

function scatter(
  seed: number,
  count: number,
  w: number,
  h: number,
  kinds: PropDef['kind'][],
  avoid: Avoid[],
  opts: { solid?: boolean; scaleMin?: number; scaleMax?: number; margin?: number; wRange?: [number, number]; hRange?: [number, number] } = {},
): PropDef[] {
  const rng = mulberry32(seed);
  const out: PropDef[] = [];
  const margin = opts.margin ?? 90;
  let guard = 0;
  while (out.length < count && guard < count * 40) {
    guard++;
    const x = margin + rng() * (w - margin * 2);
    const y = margin + rng() * (h - margin * 2);
    if (avoid.some((a) => Math.hypot(a.x - x, a.y - y) < a.r)) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.y - y) < 58)) continue;
    const kind = kinds[Math.floor(rng() * kinds.length)];
    out.push({
      x,
      y,
      kind,
      solid: opts.solid ?? true,
      scale: (opts.scaleMin ?? 0.9) + rng() * ((opts.scaleMax ?? 1.3) - (opts.scaleMin ?? 0.9)),
      w: opts.wRange ? opts.wRange[0] + rng() * (opts.wRange[1] - opts.wRange[0]) : undefined,
      h: opts.hRange ? opts.hRange[0] + rng() * (opts.hRange[1] - opts.hRange[0]) : undefined,
      variant: Math.floor(rng() * 4),
    });
  }
  return out;
}

const TOWN_NPCS: NpcDef[] = [
  { id: 'storyteller', name: '说书人·柳三弦', role: '酒楼檐下', x: 880, y: 640, color: '#7b6ea8' },
  { id: 'merchant', name: '药铺掌柜·葛九', role: '药铺', x: 620, y: 820, portrait: 'merchant', color: '#3f7a58' },
  { id: 'blacksmith', name: '铁匠·陈铁山', role: '铁匠铺', x: 1340, y: 780, color: '#8a5a3b' },
  { id: 'guard', name: '守门人·老秦', role: '东门', x: 1780, y: 820, color: '#5d6b78' },
];

function town(): RegionDef {
  const w = 2100;
  const h = 1500;
  const fixed: PropDef[] = [
    { x: 420, y: 330, kind: 'house', solid: true, w: 300, h: 176, variant: 0 },
    { x: 880, y: 300, kind: 'house', solid: true, w: 260, h: 156, variant: 1 },
    { x: 1340, y: 320, kind: 'house', solid: true, w: 300, h: 176, variant: 2 },
    { x: 1740, y: 360, kind: 'house', solid: true, w: 250, h: 146, variant: 3 },
    { x: 640, y: 700, kind: 'stall', solid: true, w: 150, h: 70 },
    { x: 1380, y: 690, kind: 'stall', solid: true, w: 130, h: 62 },
    { x: 1080, y: 830, kind: 'well', solid: true, w: 66, h: 46 },
    { x: 1990, y: 800, kind: 'gate', solid: false, w: 150, h: 40 },
    { x: 500, y: 800, kind: 'lantern', solid: true, w: 14, h: 10 },
    { x: 760, y: 780, kind: 'lantern', solid: true, w: 14, h: 10 },
    { x: 1220, y: 800, kind: 'lantern', solid: true, w: 14, h: 10 },
    { x: 1560, y: 800, kind: 'lantern', solid: true, w: 14, h: 10 },
    { x: 1900, y: 830, kind: 'lantern', solid: true, w: 14, h: 10 },
    { x: 980, y: 600, kind: 'banner', solid: false, w: 20, h: 56 },
    { x: 380, y: 620, kind: 'banner', solid: false, w: 20, h: 56 },
    { x: 1600, y: 640, kind: 'banner', solid: false, w: 20, h: 56 },
    { x: 1100, y: 1030, kind: 'bones', solid: false, variant: 1 },
  ];
  const avoid: Avoid[] = [
    { x: 1060, y: 1020, r: 120 },
    { x: 1990, y: 800, r: 180 },
    ...TOWN_NPCS.map((n) => ({ x: n.x, y: n.y, r: 100 })),
    ...fixed.map((p) => ({ x: p.x, y: p.y, r: Math.max(60, (p.w ?? 40) / 2 + 24) })),
  ];
  const nature = scatter(11, 44, w, h, ['tree', 'bamboo', 'rock', 'grass'], avoid, {
    solid: true,
    scaleMin: 0.85,
    scaleMax: 1.35,
    margin: 60,
  }).map((p) => ({ ...p, solid: p.kind !== 'grass' }));
  return {
    id: 'town',
    name: '青石镇',
    w,
    h,
    ground: 'town',
    dark: 0.5,
    tint: 'rgba(60,80,96,0.10)',
    portals: [
      {
        x: 1990,
        y: 800,
        to: 'forest',
        tx: 220,
        ty: 850,
        label: '枯木林',
        hint: '东门之外，便是枯木林。',
      },
    ],
    npcs: TOWN_NPCS,
    props: [...fixed, ...nature],
    spawns: [],
    nodes: [],
    chests: [{ id: 'town_chest', x: 300, y: 1120, money: 40, item: 'herb', count: 2 }],
    spawn: { x: 1060, y: 1020 },
  };
}

function forest(): RegionDef {
  const w = 2400;
  const h = 1700;
  const fixed: PropDef[] = [
    { x: 120, y: 850, kind: 'gate', solid: false, w: 130, h: 36 },
    { x: 2280, y: 800, kind: 'gate', solid: false, w: 130, h: 36 },
    { x: 420, y: 850, kind: 'torch', solid: true, w: 12, h: 10 },
    { x: 820, y: 820, kind: 'torch', solid: true, w: 12, h: 10 },
    { x: 1260, y: 800, kind: 'torch', solid: true, w: 12, h: 10 },
    { x: 1700, y: 800, kind: 'torch', solid: true, w: 12, h: 10 },
    { x: 2120, y: 810, kind: 'torch', solid: true, w: 12, h: 10 },
    { x: 1500, y: 1260, kind: 'bones', solid: false, variant: 0 },
    { x: 900, y: 480, kind: 'bones', solid: false, variant: 2 },
    { x: 1900, y: 1180, kind: 'bones', solid: false, variant: 3 },
  ];
  const avoid: Avoid[] = [
    { x: 220, y: 850, r: 160 },
    { x: 2280, y: 800, r: 160 },
    { x: 620, y: 560, r: 120 },
    { x: 1180, y: 1120, r: 120 },
    { x: 1760, y: 520, r: 120 },
    { x: 1960, y: 1180, r: 120 },
  ];
  const trees = scatter(23, 62, w, h, ['tree', 'deadwood', 'bamboo', 'rock'], avoid, {
    solid: true,
    scaleMin: 0.9,
    scaleMax: 1.5,
    margin: 50,
  });
  const grass = scatter(24, 52, w, h, ['grass'], avoid, {
    solid: false,
    scaleMin: 0.7,
    scaleMax: 1.3,
    margin: 30,
  });
  return {
    id: 'forest',
    name: '枯木林',
    w,
    h,
    ground: 'forest',
    dark: 0.64,
    tint: 'rgba(36,86,66,0.10)',
    portals: [
      { x: 120, y: 850, to: 'town', tx: 1900, ty: 800, label: '青石镇' },
      {
        x: 2280,
        y: 800,
        to: 'temple',
        tx: 220,
        ty: 860,
        label: '荒寺',
        need: 'forest_cleared',
        hint: '林间煞气未散，影狼还在盯着你。先斩尽六头影狼。',
      },
    ],
    npcs: [],
    props: [...fixed, ...trees, ...grass],
    spawns: [
      { kind: 'wolf', x: 620, y: 560, count: 2, radius: 160, respawn: true },
      { kind: 'wolf', x: 1180, y: 1120, count: 2, radius: 190, respawn: true },
      { kind: 'wolf', x: 1760, y: 520, count: 2, radius: 180, respawn: true },
      { kind: 'ghost', x: 1960, y: 1180, count: 2, radius: 150, respawn: true },
    ],
    nodes: [
      { id: 'f_herb1', x: 480, y: 1180, item: 'herb', count: 1 },
      { id: 'f_herb2', x: 1020, y: 420, item: 'herb', count: 1 },
      { id: 'f_herb3', x: 1420, y: 1080, item: 'herb', count: 1 },
      { id: 'f_herb4', x: 2020, y: 460, item: 'herb', count: 1 },
      { id: 'f_herb5', x: 860, y: 1380, item: 'herb', count: 1 },
      { id: 'f_herb6', x: 1780, y: 1400, item: 'herb', count: 1 },
    ],
    chests: [{ id: 'forest_chest', x: 2160, y: 1420, money: 60, item: 'bloodsand', count: 2 }],
    spawn: { x: 220, y: 850 },
  };
}

function temple(): RegionDef {
  const w = 2200;
  const h = 1500;
  const fixed: PropDef[] = [
    { x: 120, y: 860, kind: 'gate', solid: false, w: 130, h: 36 },
    { x: 2080, y: 700, kind: 'gate', solid: false, w: 150, h: 40 },
    { x: 1080, y: 780, kind: 'shrine', solid: true, w: 56, h: 38 },
    { x: 1080, y: 360, kind: 'statue', solid: true, w: 54, h: 38 },
    { x: 620, y: 380, kind: 'pillar', solid: true, w: 30, h: 26 },
    { x: 900, y: 380, kind: 'pillar', solid: true, w: 30, h: 26 },
    { x: 1260, y: 380, kind: 'pillar', solid: true, w: 30, h: 26 },
    { x: 1540, y: 380, kind: 'pillar', solid: true, w: 30, h: 26 },
    { x: 620, y: 1120, kind: 'pillar', solid: true, w: 30, h: 26 },
    { x: 900, y: 1120, kind: 'pillar', solid: true, w: 30, h: 26 },
    { x: 1260, y: 1120, kind: 'pillar', solid: true, w: 30, h: 26 },
    { x: 1540, y: 1120, kind: 'pillar', solid: true, w: 30, h: 26 },
    { x: 780, y: 760, kind: 'brazier', solid: true, w: 34, h: 24 },
    { x: 1380, y: 760, kind: 'brazier', solid: true, w: 34, h: 24 },
    { x: 1080, y: 1000, kind: 'censer', solid: true, w: 40, h: 28 },
    { x: 420, y: 600, kind: 'banner', solid: false, w: 22, h: 60 },
    { x: 1760, y: 600, kind: 'banner', solid: false, w: 22, h: 60 },
    { x: 1850, y: 900, kind: 'banner', solid: false, w: 22, h: 60 },
    { x: 1620, y: 470, kind: 'banner', solid: false, w: 22, h: 60 },
  ];
  const avoid: Avoid[] = [
    { x: 220, y: 860, r: 150 },
    { x: 2080, y: 700, r: 170 },
    { x: 1080, y: 780, r: 150 },
    { x: 1780, y: 720, r: 160 },
    { x: 1080, y: 360, r: 120 },
    ...fixed.map((p) => ({ x: p.x, y: p.y, r: Math.max(50, (p.w ?? 30) / 2 + 18) })),
  ];
  const rubble = scatter(31, 26, w, h, ['rock', 'deadwood', 'bones'], avoid, {
    solid: true,
    scaleMin: 0.8,
    scaleMax: 1.3,
    margin: 80,
  });
  const grass = scatter(32, 24, w, h, ['grass'], avoid, {
    solid: false,
    margin: 40,
  });
  return {
    id: 'temple',
    name: '荒寺',
    w,
    h,
    ground: 'temple',
    dark: 0.6,
    tint: 'rgba(50,86,110,0.10)',
    portals: [
      { x: 120, y: 860, to: 'forest', tx: 2180, ty: 800, label: '枯木林' },
      {
        x: 2080,
        y: 700,
        to: 'cliff',
        tx: 240,
        ty: 1160,
        label: '断崖',
        need: 'key',
        hint: '佛门紧闭，门上的凹槽像是一枚钥匙的形状。',
      },
    ],
    npcs: [],
    props: [...fixed, ...rubble, ...grass],
    spawns: [
      { kind: 'monk', x: 780, y: 520, count: 1, radius: 80, respawn: true },
      { kind: 'monk', x: 1500, y: 1050, count: 1, radius: 100, respawn: true },
      { kind: 'ghost', x: 1850, y: 460, count: 1, radius: 100, respawn: true },
      { kind: 'ghost', x: 620, y: 1280, count: 1, radius: 100, respawn: true },
      {
        kind: 'monk',
        x: 1780,
        y: 720,
        count: 1,
        radius: 0,
        elite: true,
        name: '守钥僧',
        key: 'key',
        respawn: false,
      },
    ],
    nodes: [
      { id: 't_herb1', x: 500, y: 980, item: 'herb', count: 1 },
      { id: 't_herb2', x: 1620, y: 1320, item: 'herb', count: 1 },
      { id: 't_ghost1', x: 1850, y: 1150, item: 'ghostfire', count: 1 },
      { id: 't_ghost2', x: 320, y: 420, item: 'ghostfire', count: 1 },
    ],
    chests: [{ id: 'temple_chest', x: 1980, y: 1320, money: 80, item: 'ghostfire', count: 2 }],
    shrine: { x: 1080, y: 780 },
    spawn: { x: 220, y: 860 },
  };
}

function cliff(): RegionDef {
  const w = 1900;
  const h = 1400;
  const fixed: PropDef[] = [
    { x: 120, y: 1160, kind: 'gate', solid: false, w: 130, h: 36 },
    { x: 440, y: 1160, kind: 'shrine', solid: true, w: 56, h: 38 },
    { x: 780, y: 980, kind: 'brazier', solid: true, w: 34, h: 24 },
    { x: 1520, y: 980, kind: 'brazier', solid: true, w: 34, h: 24 },
    { x: 700, y: 420, kind: 'brazier', solid: true, w: 34, h: 24 },
    { x: 1600, y: 420, kind: 'brazier', solid: true, w: 34, h: 24 },
    { x: 1160, y: 240, kind: 'statue', solid: true, w: 54, h: 38 },
    { x: 300, y: 500, kind: 'rock', solid: true, scale: 1.6 },
    { x: 1680, y: 700, kind: 'rock', solid: true, scale: 1.5 },
    { x: 980, y: 1240, kind: 'bones', solid: false, variant: 0 },
    { x: 1400, y: 700, kind: 'bones', solid: false, variant: 1 },
    { x: 520, y: 700, kind: 'deadwood', solid: true, scale: 1.3 },
  ];
  const avoid: Avoid[] = [
    { x: 240, y: 1160, r: 150 },
    { x: 440, y: 1160, r: 120 },
    { x: 1150, y: 650, r: 260 },
    ...fixed.map((p) => ({ x: p.x, y: p.y, r: Math.max(50, (p.w ?? 40) / 2 + 16) })),
  ];
  const rubble = scatter(41, 24, w, h, ['rock', 'deadwood', 'bones'], avoid, {
    solid: true,
    scaleMin: 0.8,
    scaleMax: 1.4,
    margin: 90,
  });
  return {
    id: 'cliff',
    name: '断崖',
    w,
    h,
    ground: 'cliff',
    dark: 0.66,
    tint: 'rgba(120,36,30,0.12)',
    portals: [{ x: 120, y: 1160, to: 'temple', tx: 1980, ty: 720, label: '荒寺' }],
    npcs: [],
    props: [...fixed, ...rubble],
    spawns: [],
    nodes: [],
    chests: [],
    shrine: { x: 440, y: 1160 },
    spawn: { x: 240, y: 1160 },
    boss: { x: 1150, y: 650, triggerX: 700 },
  };
}

export const REGIONS: Record<RegionId, () => RegionDef> = {
  town,
  forest,
  temple,
  cliff,
};

export function buildRegion(id: RegionId): RegionDef {
  return REGIONS[id]();
}
