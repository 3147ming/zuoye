export type RegionId = 'town' | 'forest' | 'temple' | 'cliff';

export type ItemId =
  | 'herb'
  | 'bloodsand'
  | 'bone'
  | 'ghostfire'
  | 'pill_heal'
  | 'pill_chi'
  | 'pill_speed'
  | 'pill_guard'
  | 'key'
  | 'talisman';

export type EnemyKind = 'wolf' | 'ghost' | 'monk' | 'boss';

export type PropKind =
  | 'tree'
  | 'deadwood'
  | 'rock'
  | 'boulder'
  | 'lantern'
  | 'torch'
  | 'bamboo'
  | 'grass'
  | 'statue'
  | 'pillar'
  | 'banner'
  | 'well'
  | 'stall'
  | 'bones'
  | 'shrine'
  | 'house'
  | 'censer'
  | 'brazier'
  | 'gate'
  | 'fence';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PropDef {
  x: number;
  y: number;
  kind: PropKind;
  scale?: number;
  solid?: boolean;
  w?: number;
  h?: number;
  variant?: number;
}

export interface PortalDef {
  x: number;
  y: number;
  to: RegionId;
  tx: number;
  ty: number;
  label: string;
  need?: string;
  hint?: string;
}

export interface NpcDef {
  id: string;
  name: string;
  role: string;
  x: number;
  y: number;
  portrait?: 'merchant' | 'boss';
  color: string;
}

export interface SpawnDef {
  kind: EnemyKind;
  x: number;
  y: number;
  count: number;
  radius: number;
  elite?: boolean;
  name?: string;
  key?: string;
  respawn?: boolean;
}

export interface NodeDef {
  id: string;
  x: number;
  y: number;
  item: ItemId;
  count: number;
}

export interface ChestDef {
  id: string;
  x: number;
  y: number;
  money?: number;
  item?: ItemId;
  count?: number;
}

export interface ShrineDef {
  x: number;
  y: number;
}

export interface RegionDef {
  id: RegionId;
  name: string;
  w: number;
  h: number;
  ground: 'town' | 'forest' | 'temple' | 'cliff';
  dark: number;
  tint: string;
  portals: PortalDef[];
  npcs: NpcDef[];
  props: PropDef[];
  spawns: SpawnDef[];
  nodes: NodeDef[];
  chests: ChestDef[];
  shrine?: ShrineDef;
  spawn: { x: number; y: number };
  boss?: { x: number; y: number; triggerX: number };
}

export interface Vec2 {
  x: number;
  y: number;
}
