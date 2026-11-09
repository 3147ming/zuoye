import type { Input } from '../core/input';
import type { Sfx } from '../core/audio';
import type { EnemyKind, ItemId, RegionDef } from '../types';
import type { Fx3D } from './fx3d';
import type { World3D } from './world3d';
import type { Player3D } from './player3d';
import type { Enemy3D } from './enemies3d';
import type { Boss3D } from './boss3d';

export interface PickupSpec {
  x: number;
  y: number;
  item?: ItemId;
  money?: number;
  count?: number;
}

export interface Game3DRef {
  fx: Fx3D;
  audio: Sfx;
  input: Input;
  time: number;
  player: Player3D;
  enemies: Enemy3D[];
  boss: Boss3D | null;
  region: RegionDef;
  world: World3D;
  flags: Set<string>;

  hitEnemies(
    x: number,
    y: number,
    angle: number,
    range: number,
    halfArc: number,
    damage: number,
    knockback?: number,
  ): number;
  areaEnemies(x: number, y: number, radius: number, damage: number, knockback?: number): number;
  aimAssist(x: number, y: number, aim: number, range: number, arc: number): number;
  damagePlayer(amount: number, fromX: number, fromY: number): void;
  shake(v: number): void;
  slowmo(duration: number, scale: number): void;
  punchZoom(v: number): void;
  flash(color: string, alpha: number): void;
  spawnProjectile(x: number, y: number, angle: number, speed: number, damage: number, kind: 'fire' | 'soul'): void;
  spawnEnemy(kind: EnemyKind, x: number, y: number, elite?: boolean, name?: string, key?: string): void;
  spawnPickup(spec: PickupSpec): void;
  toast(msg: string): void;
  banner(title: string, sub?: string): void;
  addMoney(n: number): void;
  grantItem(id: ItemId, n: number, announce?: boolean): void;
  onPerfectDodge(): void;
  onEnemyKilled(e: Enemy3D): void;
  onPlayerDeath(): void;
  onBossDefeated(): void;
}
