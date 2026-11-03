/**
 * devmodels.js — 元件电学模型注册表
 *
 * 与 parts.js 的分工：
 *   parts.js   管"长什么样"——外观、占位、端子位置；
 *   本文件     管"电气上是什么"——导纳 / 源 / 非线性 I(V)。
 *   两者靠 `type` 对齐：parts.js 里有的类型，这里必须有模型或显式标记 skip。
 *   覆盖关系由 tools/test-model.mjs 断言锁定，不靠人工记忆。
 *
 * 模型接口（统一四件套）：
 *   pins        ['第一端', '第二端']，名字必须与 parts.js 的 terminals 一致
 *   isNonlinear 是否需要在 NR 每一轮重建
 *   conducts(params)      直流上是否导通（供 simdc 做接地可达性剪枝）
 *   validate(params)      参数合法性，返回错误文案或 null
 *   stampLinear(A, b, refs, params)      线性贡献；非线性元件也用它做初值
 *   stampNR(A, b, refs, params, x)       在当前迭代点 x 上的切线（F/J）贡献
 *
 * refs 结构（由 simdc 装配）：
 *   { pos, neg, br, size, comp }
 *   pos/neg 为节点下标，-1 表示该端接地（接地端不占行列）
 *   br 为该元件的支路电流未知量下标（仅电压源需要），-1 表示没有
 *   size 为当前矩阵维度，stamp 辅助函数需要它做越界保护
 *
 * MNA 符号约定（全文件统一，改动前请先读这段）：
 *   - 节点方程按「流出节点的电流之和 = 0」建立，等价于 G·v = i_injected
 *   - 电导 g 接在 p、n 之间：stampConductance 写 4 个位置
 *   - 电流源 I 从 p 经元件内部流向 n：b[p] -= I，b[n] += I
 *   - 电压源支路电流 i 定义为「从 + 端流入、从 − 端流出」：
 *     b[br] = V，因此 V 源输出功率时 i < 0
 */

import { stampAdd, stampConductance, stampRhs } from './solver.js';

/* ==========================================================================
   物理常数
   ========================================================================== */

/** 热电压 @25℃（kT/q） */
export const VT_25C = 0.02585;

/**
 * LED 发射系数（理想因子）。
 *
 * 取 1.0 = 理想二极管。与 Is=1e-14 组合后，mA 级电流下压降落在 0.66~0.81V，
 * 对应指令包「LED 压降 ≈ 0.7V」的硬标准（5V/220Ω → 0.728V @ 16.8mA）。
 *
 * 想改成"真实红光 LED 手感"（20mA 时约 1.9V）把这里调到 2.6；
 * 指令包原文给的 1.8 与 Is=1e-14 组合会得到 1.31V——既不是 0.7V 也不是真实 LED 的 1.9V，
 * 属于文档内部两个数字（0.7V 与 n=1.8）互相矛盾，这里按可验证的 0.7V 对齐。
 */
export const LED_N = 1.0;

/** LED 反向饱和电流（A），1e-14 对应小功率 LED 的量级 */
export const LED_IS = 1e-14;

/** LED 的等效热电压 n·Vt */
export const LED_VT = LED_N * VT_25C;

/**
 * 导通临界电压 vcrit：二极管电流等于「切线电流」的那个点。
 * vcrit = nVt · ln( nVt / (√2 · Is) )
 * 高于此点后指数项过陡，必须做电压限制（见 limitJunction）。
 */
export const LED_VCRIT = LED_VT * Math.log(LED_VT / (Math.SQRT2 * LED_IS));

/** 开关闭合时的导通电阻（Ω）。1μΩ 对 1Ω~1MΩ 的电路相对误差 ≤ 1e-6 */
export const SWITCH_RON = 1e-6;

/** exp() 参数上限，防止 Math.exp 溢出成 Infinity（700 已远超物理量程） */
const EXP_LIMIT = 700;

/* ==========================================================================
   LED 的非线性处理
   ========================================================================== */

/**
 * 结电压限制器（对应 SPICE 的 pnjlim，但改为无状态版本）。
 *
 * 为什么需要它：指数模型的斜率是 I/nVt，在 5V 附近牛顿步长被死死限制在
 * 一个 nVt（≈25.9mV）上——从 5V 爬到 0.73V 要 150 多轮，远超 20 轮预算。
 * 限制器的做法是：把「比较点」沿对数轴压缩，
 *   vlim = vcrit + nVt·ln(1 + (vd - vcrit)/nVt)      (vd > vcrit)
 * 于是第一轮就能从 5V 直接落到 0.86V 附近，约 9 轮收敛。
 *
 * 无状态的代价：若工作点本身就在 vcrit 以上（大电流），限制器会一直生效，
 * 迭代不动点不再是真解。所以 simdc 的求解分两段：先用限制器求全局收敛，
 * 再用纯净牛顿从该点精修——第二段在解附近二次收敛，3~4 轮即到 1e-12。
 */
export function limitJunction(vd, vt = LED_VT, vcrit = LED_VCRIT) {
  if (!Number.isFinite(vd) || vd <= vcrit) return vd;
  return vcrit + vt * Math.log(1 + (vd - vcrit) / vt);
}

/** LED 电流 I(Vd) = Is·(e^(Vd/nVt) − 1) */
export function ledCurrent(vd, is = LED_IS, vt = LED_VT) {
  const arg = Math.min(vd / vt, EXP_LIMIT);
  return is * (Math.exp(arg) - 1);
}

/** LED 微分电导 dI/dV */
export function ledConductance(vd, is = LED_IS, vt = LED_VT) {
  const arg = Math.min(vd / vt, EXP_LIMIT);
  return (is / vt) * Math.exp(arg);
}

/** 给定电流下的正向压降（反解指数式，供测试与装配参考） */
export function ledVoltageAt(current, is = LED_IS, vt = LED_VT) {
  const ratio = Math.abs(current) / is;
  if (!(ratio > 0)) return -Infinity;
  return vt * Math.log(ratio + 1);
}

/* ==========================================================================
   模型定义
   ========================================================================== */

/** 电阻：欧姆定律 G = 1/R */
const resistorModel = {
  id: 'resistor',
  label: '电阻',
  pins: ['1', '2'],
  isNonlinear: false,
  conducts: () => true,
  validate(params) {
    const r = Number(params.resistance);
    if (!Number.isFinite(r) || r <= 0) return '电阻值必须为正';
    return null;
  },
  stampLinear(A, b, refs, params) {
    const g = 1 / Number(params.resistance);
    stampConductance(A, refs.size, refs.pos, refs.neg, g);
  },
};

/**
 * LED：指数模型（理想二极管 + 串联体电阻的近似）
 * I = Is·(e^(Vd/nVt) − 1)，n = 1.0，Is = 1e-14 A @25℃
 * → mA 级电流下压降 0.66~0.81V（5V/220Ω 为 0.731V）
 *
 * 选指数模型而不是 0.7V 分片线性的理由：压降随电流连续变化，
 * 换电阻值不用改阈值；代价是必须处理硬非线性（见 limitJunction）。
 */
const ledModel = {
  id: 'led',
  label: 'LED',
  pins: ['A', 'K'],
  isNonlinear: true,
  conducts: () => true,
  validate() {
    return null;
  },
  /** 线性化：取 0.7V 偏置处的切线。仅用于需要纯线性初值的场合（求解走 stampNR） */
  stampLinear(A, b, refs) {
    const vf = 0.7;
    const g = ledConductance(vf);
    const ieq = ledCurrent(vf) - g * vf;
    stampConductance(A, refs.size, refs.pos, refs.neg, g);
    stampRhs(b, refs.size, refs.pos, -ieq);
    stampRhs(b, refs.size, refs.neg, ieq);
  },
  /** 在当前迭代点做切线：g 并联一个等效电流源。refs.limit === false 时关闭结电压限制器 */
  stampNR(A, b, refs, params, x) {
    const vp = refs.pos < 0 ? 0 : x[refs.pos];
    const vn = refs.neg < 0 ? 0 : x[refs.neg];
    const vd = vp - vn;
    const used = refs.limit === false ? vd : limitJunction(vd);
    const i0 = ledCurrent(used);
    const g = ledConductance(used);
    // 切线形式 I ≈ i0 + g·(v − used)，改写成「电导 g + 电流源 ieq」
    const ieq = i0 - g * used;
    stampConductance(A, refs.size, refs.pos, refs.neg, g);
    stampRhs(b, refs.size, refs.pos, -ieq);
    stampRhs(b, refs.size, refs.neg, ieq);
  },
};

/**
 * 开关：闭合 = 1μΩ 导通电阻（不接理想 0V 源，避免两个开关并联时
 * 出现"支路电流不唯一"的奇异结构）；断开 = 完全不参与方程。
 */
const switchModel = {
  id: 'switch',
  label: '开关',
  pins: ['COM', 'NO'],
  isNonlinear: false,
  conducts: (params) => params.state === 'closed',
  validate(params) {
    if (params.state !== 'closed' && params.state !== 'open') return '开关状态非法';
    return null;
  },
  stampLinear(A, b, refs, params) {
    if (params.state !== 'closed') return;
    stampConductance(A, refs.size, refs.pos, refs.neg, 1 / SWITCH_RON);
  },
};

/** 电容：直流开路——不进方程，但结果里仍报两端电压与「直流开路」标注 */
const capacitorModel = {
  id: 'capacitor',
  label: '电容',
  pins: ['1', '2'],
  isNonlinear: false,
  conducts: () => false,
  /**
   * 暂态下电容是有记忆的导通元件（能传导电流），
   * 供 simtrans 的接地可达性剪枝用；直流剪枝仍走 conducts()。
   */
  conductsTransient: () => true,
  validate() {
    return null;
  },
  stampLinear() {
    // 直流下理想电容 = 开路，不 stamp 任何东西
  },
  /**
   * 暂态伴随模型（梯形积分 + 首步后向欧拉启动）。
   *
   * 梯形格式：i[k] = (2C/dt)·(v[k] − v[k−1]) − i[k−1] = G·v[k] − I0
   *   G = 2C/dt，I0 = G·v[k−1] + i[k−1]
   * 首步没有可信的 i[0]，改用后向欧拉（G = C/dt、I0 = G·v[0]）起步，
   * 之后全程梯形。选型实测见 simtrans.js 文件头注释。
   *
   * ctx = { dt, vPrev, iPrev, startup }
   */
  stampTransient(A, b, refs, params, ctx) {
    const c = capacitanceOf(params);
    const pair = transientCompanion(c, ctx);
    stampConductance(A, refs.size, refs.pos, refs.neg, pair.g);
    // 常数项等效电流源 I0 从 n 端流向 p 端（见文件头 MNA 符号约定）
    stampRhs(b, refs.size, refs.pos, pair.i0);
    stampRhs(b, refs.size, refs.neg, -pair.i0);
  },
  note: () => '直流开路',
};

/** 读容值（存储单位 F；非法/缺省按 0 处理，调用方负责告警） */
export function capacitanceOf(params) {
  const c = Number(params && params.capacitance);
  return Number.isFinite(c) && c > 0 ? c : 0;
}

/**
 * 电容伴随模型系数。
 * @param {number} c 容值（F）
 * @param {{dt:number, vPrev:number, iPrev:number, startup?:boolean}} ctx
 * @returns {{g:number, i0:number}}  i = g·v − i0
 */
export function transientCompanion(c, ctx) {
  const dt = Number(ctx && ctx.dt);
  const vPrev = Number(ctx && ctx.vPrev) || 0;
  const iPrev = Number(ctx && ctx.iPrev) || 0;
  if (!(dt > 0) || !(c > 0)) return { g: 0, i0: 0 };
  if (ctx && ctx.startup) {
    // 首步：后向欧拉 G = C/dt，I0 = G·vPrev（不需要 iPrev）
    const g = c / dt;
    return { g, i0: g * vPrev };
  }
  const g = (2 * c) / dt;
  return { g, i0: g * vPrev + iPrev };
}

/** 由解出的 v 反推本步电容电流：i = g·v − i0 */
export function transientCurrent(pair, v) {
  return pair.g * v - pair.i0;
}

/** 理想电压源：MNA 增广一行一列，引入支路电流未知量 */
const vsourceModel = {
  id: 'vsource',
  label: '电压源',
  pins: ['+', '-'],
  isNonlinear: false,
  needsBranch: true,
  conducts: () => true,
  validate(params) {
    if (!Number.isFinite(Number(params.voltage))) return '电压源电压值非法';
    return null;
  },
  stampLinear(A, b, refs, params) {
    const v = Number(params.voltage);
    const { pos, neg, br, size } = refs;
    if (br < 0) return;
    // 节点方程：电流 i 从 + 流入、从 − 流出
    stampAdd(A, size, pos, br, 1);
    stampAdd(A, size, neg, br, -1);
    // 支路方程：v(+) − v(−) = V
    stampAdd(A, size, br, pos, 1);
    stampAdd(A, size, br, neg, -1);
    stampRhs(b, size, br, v);
  },
};

/** 理想电流源：电流从 + 经元件内部流向 − */
const isourceModel = {
  id: 'isource',
  label: '电流源',
  pins: ['+', '-'],
  isNonlinear: false,
  conducts: () => true,
  validate(params) {
    if (!Number.isFinite(Number(params.current))) return '电流源电流值非法';
    return null;
  },
  stampLinear(A, b, refs, params) {
    const i = Number(params.current);
    stampRhs(b, refs.size, refs.pos, -i);
    stampRhs(b, refs.size, refs.neg, i);
  },
};

/**
 * 74 系列：数字器件，直流工作点无意义。
 * 显式标为 skip 而不是"缺模型"——缺模型是错误（说明有人加了元件忘了写模型），
 * skip 是本包已知的、有意留空的分工。
 */
const ic74xxModel = {
  id: 'ic74xx',
  label: '74 系列芯片',
  skip: true,
  reason: '数字元件，包 6 处理',
};

/* ==========================================================================
   注册表与查询
   ========================================================================== */

export const MODELS = {
  resistor: resistorModel,
  led: ledModel,
  switch: switchModel,
  capacitor: capacitorModel,
  vsource: vsourceModel,
  isource: isourceModel,
  ic74xx: ic74xxModel,
};

/** 取模型，未知类型返回 null */
export function getModel(type) {
  return Object.prototype.hasOwnProperty.call(MODELS, type) ? MODELS[type] : null;
}

/** 是否有可直接参与方程的模型（skip 不算） */
export function hasModel(type) {
  const model = getModel(type);
  return Boolean(model) && !model.skip;
}

/** 是否为「已知但有意跳过」的类型 */
export function isSkipped(type) {
  const model = getModel(type);
  return Boolean(model) && Boolean(model.skip);
}

/** 已注册的模型类型列表 */
export function listModelTypes() {
  return Object.keys(MODELS);
}

/** 需要支路电流未知量的类型（MNA 增广） */
export function needsBranch(type) {
  const model = getModel(type);
  return Boolean(model) && model.needsBranch === true;
}

/** 直流上是否导通（接地可达性剪枝用；无模型时按不导通处理） */
export function conductsDC(type, params) {
  const model = getModel(type);
  if (!model || model.skip || typeof model.conducts !== 'function') return false;
  return Boolean(model.conducts(params || {}));
}

/**
 * 暂态上是否导通（接地可达性剪枝用）。
 * 与直流的唯一差别：电容在暂态下能传导电流（有记忆的导通元件），
 * 于是「只靠电容接到地」的网在暂态里是可达的、会进方程。
 */
export function conductsTransient(type, params) {
  const model = getModel(type);
  if (!model || model.skip) return false;
  if (typeof model.conductsTransient === 'function') {
    return Boolean(model.conductsTransient(params || {}));
  }
  if (typeof model.conducts !== 'function') return false;
  return Boolean(model.conducts(params || {}));
}

/** 模型参数校验：返回错误文案或 null */
export function validateParams(type, params) {
  const model = getModel(type);
  if (!model || model.skip) return null;
  if (typeof model.validate !== 'function') return null;
  return model.validate(params || {});
}

/** 模型的固定备注（如电容「直流开路」） */
export function modelNote(type) {
  const model = getModel(type);
  if (!model || typeof model.note !== 'function') return '';
  return model.note();
}
