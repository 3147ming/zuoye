import type { FX } from '../core/fx';
import type { Sfx } from '../core/audio';
import type { EnemyKind, ItemId, RegionDef } from '../types';
import type { Enemy } from './enemies';
import type { Boss } from './boss';
import type { Player } from './player';
import type { World } from './world';

export interface PickupSpec {
  x: number;
  y: number;
  item?: ItemId;
  money?: number;
  count?: number;
}

export interface GameRef {
  fx: FX;
  audio: Sfx;
  time: number;
  player: Player;
  enemies: Enemy[];
  boss: Boss | null;
  region: RegionDef;
  world: World;
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
  damagePlayer(amount: number, fromX: number, fromY: number): void;
  shake(v: number): void;
  slowmo(duration: number, scale: number): void;
  punchZoom(v: number): void;
  flash(color: string, alpha: number): void;
  spawnProjectile(x: number, y: number, angle: number, speed: number, damage: number, kind: 'fire' | 'soul'): void;
  spawnEnemy(kind: EnemyKind, x: number, y: number, elite?: boolean, name?: string, key?: string): Enemy;
  spawnPickup(spec: PickupSpec): void;
  toast(msg: string): void;
  banner(title: string, sub?: string): void;
  addMoney(n: number): void;
  grantItem(id: ItemId, n: number, announce?: boolean): void;
  onPerfectDodge(): void;
  onEnemyKilled(e: Enemy): void;
  onPlayerDeath(): void;
  onBossDefeated(): void;
}
