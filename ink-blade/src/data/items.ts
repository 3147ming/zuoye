import type { ItemId } from '../types';

export interface ItemDef {
  id: ItemId;
  name: string;
  type: 'pill' | 'material' | 'key';
  desc: string;
  price?: number;
  color: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  herb: {
    id: 'herb',
    name: '青灵草',
    type: 'material',
    desc: '枯木林与古寺之间生长的灵草，叶脉泛着微光，是炼丹的主药。',
    price: 12,
    color: '#6fc98a',
  },
  bloodsand: {
    id: 'bloodsand',
    name: '血砂',
    type: 'material',
    desc: '浸过血的赤色矿砂，药性与煞气并存，慎用。',
    price: 16,
    color: '#c2483f',
  },
  bone: {
    id: 'bone',
    name: '兽骨',
    type: 'material',
    desc: '影狼的骨头，坚硬而带着野性，可入药，也可炼器。',
    price: 10,
    color: '#e6ddc4',
  },
  ghostfire: {
    id: 'ghostfire',
    name: '幽火',
    type: 'material',
    desc: '鬼火凝成的冷焰，触手不烫，却能镇住神魂。',
    price: 22,
    color: '#55e2cf',
  },
  pill_heal: {
    id: 'pill_heal',
    name: '回春丹',
    type: 'pill',
    desc: '服下回复 45 点气血。行走江湖，必备之物。',
    price: 30,
    color: '#d95a4c',
  },
  pill_chi: {
    id: 'pill_chi',
    name: '凝神散',
    type: 'pill',
    desc: '服下回复 55 点内力，让刀意重新流遍全身。',
    price: 26,
    color: '#6aa7e8',
  },
  pill_speed: {
    id: 'pill_speed',
    name: '清风散',
    type: 'pill',
    desc: '10 秒内身法与出招速度提升，步伐如风。',
    price: 36,
    color: '#8ed6a2',
  },
  pill_guard: {
    id: 'pill_guard',
    name: '金刚散',
    type: 'pill',
    desc: '8 秒内受到的伤害减半，气血如铁。',
    price: 42,
    color: '#e3c073',
  },
  key: {
    id: 'key',
    name: '残破佛钥',
    type: 'key',
    desc: '守钥僧怀中的青铜钥匙。断崖佛门，只认此物。',
    color: '#c9a34f',
  },
  talisman: {
    id: 'talisman',
    name: '幽火令',
    type: 'key',
    desc: '从影狼群中夺回的黑色令牌，背面刻着两个字：无面。',
    color: '#b3382f',
  },
};

export const SHOP_GOODS: { id: ItemId; price: number }[] = [
  { id: 'pill_heal', price: 30 },
  { id: 'pill_chi', price: 26 },
  { id: 'pill_speed', price: 36 },
  { id: 'pill_guard', price: 42 },
  { id: 'herb', price: 12 },
  { id: 'bloodsand', price: 16 },
];

export interface Recipe {
  out: ItemId;
  count: number;
  need: [ItemId, number][];
}

export const RECIPES: Recipe[] = [
  { out: 'pill_heal', count: 1, need: [['herb', 2], ['bloodsand', 1]] },
  { out: 'pill_chi', count: 1, need: [['herb', 1], ['ghostfire', 1]] },
  { out: 'pill_speed', count: 1, need: [['herb', 3], ['bone', 1]] },
  { out: 'pill_guard', count: 1, need: [['bloodsand', 2], ['bone', 2]] },
];

export class Inventory {
  map = new Map<ItemId, number>();

  count(id: ItemId) {
    return this.map.get(id) ?? 0;
  }

  add(id: ItemId, n = 1) {
    this.map.set(id, this.count(id) + n);
  }

  remove(id: ItemId, n = 1) {
    const c = this.count(id);
    if (c < n) return false;
    if (c === n) this.map.delete(id);
    else this.map.set(id, c - n);
    return true;
  }

  has(id: ItemId, n = 1) {
    return this.count(id) >= n;
  }

  entries() {
    const order: ItemId[] = [
      'pill_heal',
      'pill_chi',
      'pill_speed',
      'pill_guard',
      'herb',
      'bloodsand',
      'bone',
      'ghostfire',
      'key',
      'talisman',
    ];
    return order
      .filter((id) => this.count(id) > 0)
      .map((id) => [id, this.count(id)] as [ItemId, number]);
  }
}
