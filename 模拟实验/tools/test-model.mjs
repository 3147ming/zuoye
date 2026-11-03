/**
 * test-model.mjs — model.js / platforms.js 纯逻辑自测（node 直跑，无 DOM）
 * 运行：node tools/test-model.mjs
 */

import * as M from '../js/model.js';
import * as P from '../js/platforms.js';
import * as P2 from '../js/parts.js';
import * as S from '../js/solver.js';
import * as D from '../js/devmodels.js';
import * as SIM from '../js/simdc.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ' → ' + detail : ''}`);
  }
}

/* ---------------------------------------------------------------- 平台几何 */
{
  const bb = P.getPlatform('breadboard');
  check('面包板列数 63', bb.cols === 63, String(bb.cols));
  check('面包板行数 15', bb.rows === 15, String(bb.rows));
  check('面包板节点数 63×14=882', bb.nodes.length === 882, String(bb.nodes.length));

  const hole = 'breadboard:12-3';
  const neighbours = P.getConnectedNodes(hole);
  check('5 孔组内返回 4 个邻居', neighbours.length === 4, String(neighbours.length));
  check('邻居都同列', neighbours.every((id) => id.startsWith('breadboard:12-')), neighbours.join(','));

  const other = P.getConnectedNodes('breadboard:13-3');
  const cross = neighbours.filter((id) => other.includes(id));
  check('相邻列不同组（不连通）', cross.length === 0, cross.join(','));

  const rail = P.getConnectedNodes('breadboard:0-0');
  check('电源轨整行连通 = 62 邻居', rail.length === 62, String(rail.length));
  check('电源轨不跨到负轨', rail.every((id) => id.endsWith('-0')), rail.slice(0, 3).join(','));

  const group = P.getNodesOfGroup('breadboard:col:t12');
  check('分组查询返回 5 个节点', group.length === 5, String(group.length));
  check('上下半区不同组', !group.includes('breadboard:12-8'), group.join(','));
}

{
  const box = P.getPlatform('exp-box');
  const kinds = new Set(box.boxParts.map((part) => part.kind));
  check(
    '实验箱含 6 类以上部件',
    kinds.size >= 6,
    [...kinds].join(','),
  );
  ['holes', 'dip', 'dipswitch', 'ledbank', 'segment', 'power', 'buzzer'].forEach((kind) => {
    check(`实验箱含部件 ${kind}`, kinds.has(kind), [...kinds].join(','));
  });

  const sockets = box.boxParts.filter((part) => part.kind === 'dip');
  check('两个芯片插座', sockets.length === 2, String(sockets.length));
  const pins14 = sockets[0].nodeIds.length;
  const pins16 = sockets[1].nodeIds.length;
  check('插座① 14 脚', pins14 === 14, String(pins14));
  check('插座② 16 脚', pins16 === 16, String(pins16));

  const u1 = sockets[0].nodeIds;
  check('14 脚两排齐全', u1.filter((id) => box.nodeMap.get(id).y === 1).length === 7
    && u1.filter((id) => box.nodeMap.get(id).y === 3).length === 7, u1.join(' '));
  check('插座引脚互不连通', P.getConnectedNodes(u1[0]).length === 0,
    P.getConnectedNodes(u1[0]).join(','));

  const led = box.boxParts.find((part) => part.kind === 'ledbank');
  check('8 路指示灯 = 16 端子', led.nodeIds.length === 16, String(led.nodeIds.length));
  const sw = box.boxParts.find((part) => part.kind === 'dipswitch');
  check('8 位拨码 = 16 端子', sw.nodeIds.length === 16, String(sw.nodeIds.length));
  const seg = box.boxParts.find((part) => part.kind === 'segment');
  check('数码管 7 段 + 公共 = 8', seg.nodeIds.length === 8, String(seg.nodeIds.length));

  // 部件全部落在网格内
  const overflow = box.nodes.filter((n) => n.x < 0 || n.y < 0 || n.x >= box.cols || n.y >= box.rows);
  check('所有节点在网格内', overflow.length === 0, overflow.map((n) => n.id).join(','));

  // 自定义配置驱动
  const custom = P.rebuildExpBox([
    { id: 'only', kind: 'holes', label: 'X', x: 2, y: 2, cols: 3, rows: 5 },
  ]);
  check('boxParts 可配置', custom.nodes.length === 15, String(custom.nodes.length));
  P.rebuildExpBox(); // 还原默认
}

/* ---------------------------------------------------------------- 元件与导线 */
{
  M.createCircuit('breadboard');
  const r1 = M.addComponent('resistor', 10, 3);
  check('addComponent 成功', r1.ok === true, JSON.stringify(r1));
  check('自动分配 id', r1.ok && r1.component.id === 'resistor-1', r1.ok ? r1.component.id : '');
  check('生成 2 个端子', r1.ok && r1.component.terminals.length === 2,
    r1.ok ? String(r1.component.terminals.length) : '');
  check('端子方向取自定义', r1.ok && r1.component.terminals[0].direction === 'bidir');
  check('默认参数注入', r1.ok && r1.component.params.resistance === 1000,
    r1.ok ? String(r1.component.params.resistance) : '');

  const r2 = M.addComponent('resistor', 14, 3);
  check('第二个元件 id 递增', r2.ok && r2.component.id === 'resistor-2',
    r2.ok ? r2.component.id : '');

  // 越界
  const oob = M.addComponent('resistor', 61, 3);
  check('越界拒绝', oob.ok === false, JSON.stringify(oob));
  // 重叠
  const clash = M.addComponent('resistor', 11, 3);
  check('重叠拒绝且给出冲突 id', clash.ok === false && clash.clashId === 'resistor-1',
    JSON.stringify(clash));

  // 端子-端子
  const w1 = M.addWire(
    { componentId: 'resistor-1', terminal: '2' },
    { componentId: 'resistor-2', terminal: '1' },
  );
  check('端子-端子连线成功', w1.ok === true, JSON.stringify(w1));

  // 端子-孔位
  const w2 = M.addWire({ componentId: 'resistor-1', terminal: '1' }, { node: 'breadboard:10-3' });
  check('端子-孔位连线成功', w2.ok === true, JSON.stringify(w2));

  // 孔位-孔位（同组之外）
  const w3 = M.addWire({ node: 'breadboard:20-3' }, { node: 'breadboard:25-8' });
  check('孔位-孔位连线成功', w3.ok === true, JSON.stringify(w3));

  // 重复（顺序颠倒也算重复）
  const dup = M.addWire(
    { componentId: 'resistor-2', terminal: '1' },
    { componentId: 'resistor-1', terminal: '2' },
  );
  check('重复连接被拒绝', dup.ok === false, JSON.stringify(dup));
  check('重复连接错误文案', dup.ok === false && dup.error === '已存在连接', dup.error);

  // 同端
  const same = M.addWire(
    { componentId: 'resistor-1', terminal: '1' },
    { componentId: 'resistor-1', terminal: '1' },
  );
  check('同端连接被拒绝', same.ok === false, JSON.stringify(same));

  // 非法端点
  const bad = M.addWire({ componentId: 'nope', terminal: '1' }, { node: 'breadboard:10-3' });
  check('不存在的元件被拒绝', bad.ok === false, JSON.stringify(bad));
  const badNode = M.addWire({ node: 'breadboard:99-99' }, { node: 'breadboard:10-3' });
  check('不存在的孔位被拒绝', badNode.ok === false, JSON.stringify(badNode));
  const badShape = M.addWire({ foo: 1 }, { node: 'breadboard:10-3' });
  check('非法结构被拒绝', badShape.ok === false, JSON.stringify(badShape));

  // 网表
  const net = M.getNetOf({ componentId: 'resistor-1', terminal: '2' });
  const net2 = M.getNetOf({ componentId: 'resistor-2', terminal: '1' });
  check('导线两端同网', net !== null && net === net2, `${net} / ${net2}`);

  const netA = M.getNetOf({ componentId: 'resistor-1', terminal: '1' });
  const nodeNet = M.getNetOf({ node: 'breadboard:10-3' });
  check('端子与其接入的孔位同网', netA !== null && netA === nodeNet, `${netA} / ${nodeNet}`);

  // 平台固有连通：同组另一个孔位也应同网
  const sibling = M.getNetOf({ node: 'breadboard:10-5' });
  check('同组孔位天然同网', sibling === netA, `${sibling} / ${netA}`);

  const unwired = M.getNetOf({ node: 'breadboard:50-3' });
  check('未接线的独立 5 孔组有网（自带连通）', unwired !== null, String(unwired));

  // 删除元件连带导线
  const before = M.getState().wires.length;
  const removed = M.removeComponent('resistor-1');
  check('删除元件成功', removed.ok === true, JSON.stringify(removed));
  check('连带删除 2 条导线', removed.removedWires === 2, String(removed.removedWires));
  check('导线总数减少 2', M.getState().wires.length === before - 2,
    `${before} → ${M.getState().wires.length}`);

  // 撤销
  const stateAfterRemove = M.getState().components.length;
  const undone = M.undo();
  check('undo 返回 true', undone === true);
  check('undo 恢复元件', M.getState().components.length === stateAfterRemove + 1,
    String(M.getState().components.length));
  check('undo 恢复导线', M.getState().wires.length === before, String(M.getState().wires.length));
}

/* ---------------------------------------------------------------- 撤销粒度 */
{
  M.createCircuit('breadboard');
  const baseComponents = M.getState().components.length;
  M.addComponent('led', 5, 3);
  check('撤销前元件 +1', M.getState().components.length === baseComponents + 1);
  M.undo();
  check('撤销一次添加后清单回到原状', M.getState().components.length === baseComponents,
    String(M.getState().components.length));

  // 参数撤销
  M.createCircuit('breadboard');
  const r = M.addComponent('resistor', 3, 3);
  M.updateParams(r.component.id, { resistance: 2200 });
  check('参数已更新', M.findComponent(r.component.id).params.resistance === 2200,
    String(M.findComponent(r.component.id).params.resistance));
  M.undo();
  check('撤销参数修改', M.findComponent(r.component.id).params.resistance === 1000,
    String(M.findComponent(r.component.id).params.resistance));

  // 无变化不写栈
  const depth = M.undoDepth();
  M.updateParams(r.component.id, { resistance: 1000 });
  check('无变化的参数写入不产生撤销点', M.undoDepth() === depth, `${depth} → ${M.undoDepth()}`);

  // 空栈
  M.createCircuit('breadboard');
  check('空栈 undo 返回 false', M.undo() === false);
  check('空栈 canUndo 为 false', M.canUndo() === false);
}

/* ---------------------------------------------------------------- 校验 */
{
  M.createCircuit('breadboard');
  const r = M.addComponent('resistor', 8, 3);
  const v1 = M.validateCircuit();
  check('孤立元件被统计', v1.isolatedComponents.length === 1, v1.isolatedComponents.join(','));
  check('孤立元件端子全部孤儿', v1.orphanTerminals.length === 2, String(v1.orphanTerminals.length));

  M.addWire({ componentId: r.component.id, terminal: '1' }, { node: 'breadboard:8-3' });
  const v2 = M.validateCircuit();
  check('接一端后仅剩一个孤儿端子', v2.orphanTerminals.length === 1,
    v2.orphanTerminals.map((t) => t.terminal).join(','));
}

/* ---------------------------------------------------------------- 序列化 */
{
  M.createCircuit('breadboard');
  M.addComponent('resistor', 3, 3);
  M.addComponent('led', 7, 3);
  M.addWire({ componentId: 'resistor-1', terminal: '2' }, { componentId: 'led-1', terminal: 'A' });
  const dump = M.serializeCircuit();
  const json = JSON.parse(JSON.stringify(dump));
  check('序列化含 2 元件 1 导线', json.components.length === 2 && json.wires.length === 1,
    `${json.components.length}/${json.wires.length}`);
  check('序列化保留平台', json.platform === 'breadboard', json.platform);
  check('端子不落盘（由 parts 重建）', json.components[0].terminals === undefined);

  const report = M.loadCircuit(json, 'breadboard');
  check('恢复元件数一致', report.components === 2, JSON.stringify(report));
  check('恢复导线数一致', M.getState().wires.length === 1, String(M.getState().wires.length));
  check('恢复后网表正确',
    M.getNetOf({ componentId: 'resistor-1', terminal: '2' })
      === M.getNetOf({ componentId: 'led-1', terminal: 'A' }));
  const afterRestore = M.addComponent('resistor', 12, 3);
  check('恢复后 id 计数器不撞车（按类型独立计数）',
    afterRestore.ok && afterRestore.component.id === 'resistor-2',
    afterRestore.ok ? afterRestore.component.id : afterRestore.error);

  // 悬空导线：端点指向不存在的孔位
  const broken = {
    platform: 'exp-box',
    components: [{ id: 'resistor-9', type: 'resistor', x: 3, y: 3, rotation: 0, params: {} }],
    wires: [{ id: 'wire-x', a: { componentId: 'resistor-9', terminal: '1', x: 3, y: 3 },
      b: { node: 'breadboard:12-3', x: 12, y: 3 } }],
  };
  const rep2 = M.loadCircuit(broken, 'exp-box');
  check('跨平台导线保留而非丢弃', M.getState().wires.length === 1,
    String(M.getState().wires.length));
  check('跨平台导线被统计为悬空', rep2.danglingWires === 1, JSON.stringify(rep2));
  const v = M.validateCircuit();
  check('校验报出悬空导线', v.danglingWires.length === 1, v.danglingWires.join(','));
  const cleaned = M.removeDanglingWires();
  check('一键清理悬空导线', cleaned.removed === 1, JSON.stringify(cleaned));
}

/* ---------------------------------------------------------------- 旋转 / 暂存 */
{
  M.createCircuit('breadboard');
  const ic = M.addComponent('ic74xx', 5, 2);
  check('IC 占 7×3', M.rectOf(ic.component).w === 7 && M.rectOf(ic.component).h === 3,
    JSON.stringify(M.rectOf(ic.component)));
  const rot = M.rotateComponent(ic.component.id);
  check('旋转成功', rot.ok === true, JSON.stringify(rot));
  check('旋转后占位交换', M.rectOf(ic.component).w === 3 && M.rectOf(ic.component).h === 7,
    JSON.stringify(M.rectOf(ic.component)));
  const pin1 = P2.terminalPos(M.findComponent(ic.component.id), '1');
  check('旋转后 1 脚位置随占位重算',
    pin1 !== null && pin1.x === 5 + 2 && pin1.y === 2,
    JSON.stringify(pin1));

  // 四向循环：90 → 180 → 270 → 0 都应成功
  const r2 = M.rotateComponent(ic.component.id);
  check('四向旋转：90→180 成功', r2.ok === true && M.findComponent(ic.component.id).rotation === 180,
    JSON.stringify(r2));
  const r3 = M.rotateComponent(ic.component.id);
  check('四向旋转：180→270 成功', r3.ok === true && M.findComponent(ic.component.id).rotation === 270,
    JSON.stringify(r3));
  const r4 = M.rotateComponent(ic.component.id);
  check('四向旋转：270→0 回环', r4.ok === true && M.findComponent(ic.component.id).rotation === 0,
    JSON.stringify(r4));

  M.stashComponents('exp-box', [ic.component], []);
  check('暂存区记录 1 个元件', M.peekStash('exp-box').components.length === 1,
    String(M.peekStash('exp-box').components.length));
  const taken = M.takeStash('exp-box');
  check('取出后暂存区清空', taken.components.length === 1 && M.peekStash('exp-box').components.length === 0);
}

/* ---------------------------------------------------------------- 原理图符号库 */
{
  const S = await import('../js/symparts.js');
  const types = P2.PART_ORDER;

  // 核心约束：同一类型在 parts.js（实物端子）与 symparts.js（原理图引脚）里
  // 注册的 name 集合必须完全相等。联动靠 name 映射，差一个就找不到端点。
  types.forEach((type) => {
    const part = P2.getPart(type);
    const sym = S.getSymbol(type);
    if (!part || !sym) {
      check(`${type} 符号已注册`, false, '缺失');
      return;
    }
    const a = part.terminals.map((t) => t.name).sort();
    const b = sym.pins.map((p) => p.name).sort();
    const same = a.length === b.length && a.every((name, index) => name === b[index]);
    check(`${type} 引脚名与 parts.js 一致`, same, `${a.join('/')} vs ${b.join('/')}`);
  });

  check('符号库覆盖全部元件类型',
    types.every((type) => Boolean(S.getSymbol(type))),
    types.filter((type) => !S.getSymbol(type)).join(','));

  check('未知类型返回 null', S.getSymbol('nope') === null);

  // 每个符号的引脚名不得重复（重复会让拾取与连线指向错端子）
  const dupPins = [];
  types.forEach((type) => {
    const sym = S.getSymbol(type);
    const names = sym.pins.map((pin) => pin.name);
    if (new Set(names).size !== names.length) dupPins.push(type);
  });
  check('引脚名无重复', dupPins.length === 0, dupPins.join(','));

  // 90° 旋转：绕符号中心顺时针，左边中点 → 上边中点
  const resSym = S.getSymbol('resistor');
  const rotPin = S.pinPos(resSym, resSym.pins[0], 90);
  const halfH = resSym.size.h / 2;
  check('电阻 1 脚旋转后落到上边中点',
    Math.abs(rotPin.x - halfH) < 1e-9 && Math.abs(rotPin.y) < 1e-9,
    `(${rotPin.x}, ${rotPin.y}) 期望 (${halfH}, 0)`);
  const resSize0 = S.symSize('resistor', 0);
  const resSize90 = S.symSize('resistor', 90);
  check('旋转后占位交换宽高',
    resSize0.w === resSize90.h && resSize0.h === resSize90.w && resSize0.w !== resSize0.h,
    `${resSize0.w}×${resSize0.h} → ${resSize90.w}×${resSize90.h}`);

  // 两脚符号的引脚必须落在符号高度中点，否则同一行的两个符号连线会绕出台阶
  const offCenter = [];
  ['resistor', 'led', 'switch', 'capacitor'].forEach((type) => {
    const sym = S.getSymbol(type);
    if (sym.pins.some((pin) => Math.abs(pin.dy - sym.size.h / 2) > 1e-9)) offCenter.push(type);
  });
  check('两脚符号引脚都在高度中点', offCenter.length === 0, offCenter.join(','));

  const ledA = S.pinByName('led', 'A', 90);
  check('LED 阳极旋转后转到上边', Math.abs(ledA.y) < 1e-9 && ledA.side === 'top',
    JSON.stringify(ledA));

  const swCom = S.pinByName('switch', 'COM', 0);
  check('开关 COM 脚在左侧', swCom.x === 0 && swCom.side === 'left', JSON.stringify(swCom));

  // 74 系列按 DIP-14 真实封装：1 左上、7 左下(GND)、8 右下、14 右上(VCC)
  const ic1 = S.pinByName('ic74xx', '1', 0);
  const ic7 = S.pinByName('ic74xx', '7', 0);
  const ic8 = S.pinByName('ic74xx', '8', 0);
  const ic14 = S.pinByName('ic74xx', '14', 0);
  check('芯片 1 脚在左上', ic1.x === 0 && ic1.y === 1, JSON.stringify(ic1));
  check('芯片 7 脚在左下并标 GND', ic7.x === 0 && ic7.y === 7 && ic7.role === 'GND', JSON.stringify(ic7));
  check('芯片 8 脚在右下', ic8.x === 7 && ic8.y === 7, JSON.stringify(ic8));
  check('芯片 14 脚在右上并标 VCC', ic14.x === 7 && ic14.y === 1 && ic14.role === 'VCC', JSON.stringify(ic14));
  check('芯片引脚数为 14', S.getSymbol('ic74xx').pins.length === 14,
    String(S.getSymbol('ic74xx').pins.length));

  // 扩展注册
  check('重复注册被拒绝',
    S.registerSymbol('resistor', { size: { w: 2, h: 2 }, pins: [], draw() {} }) === false);
  check('引脚重名的定义被拒绝',
    S.registerSymbol('bad', {
      size: { w: 2, h: 2 },
      pins: [{ name: 'A' }, { name: 'A' }],
      draw() {},
    }) === false);
  const registered = S.registerSymbol('demo', {
    label: '示例',
    size: { w: 2, h: 2 },
    pins: [
      { name: 'X', dx: 0, dy: 1, side: 'left' },
      { name: 'Y', dx: 2, dy: 1, side: 'right' },
    ],
    draw() {},
    labelText: () => 'DEMO',
  });
  check('可扩展注册新符号', registered === true && Boolean(S.getSymbol('demo')));
  check('注册后 symSize 生效', S.symSize('demo', 0).w === 2 && S.symSize('demo', 90).w === 2);

  // 工程单位格式化：面板显示与原理图标签必须同一口径
  check('1000Ω → 1kΩ', S.formatOhm(1000) === '1kΩ', S.formatOhm(1000));
  check('2200Ω → 2.2kΩ', S.formatOhm(2200) === '2.2kΩ', S.formatOhm(2200));
  check('470Ω 保持 Ω', S.formatOhm(470) === '470Ω', S.formatOhm(470));
  check('1e6Ω → 1MΩ', S.formatOhm(1e6) === '1MΩ', S.formatOhm(1e6));
  check('1e-5F → 10μF', S.formatFarad(1e-5) === '10μF', S.formatFarad(1e-5));
  check('1e-9F → 1nF', S.formatFarad(1e-9) === '1nF', S.formatFarad(1e-9));

  check('电阻标签含阻值',
    S.symbolLabel({ type: 'resistor', params: { resistance: 2200 } }) === 'R 2.2kΩ',
    S.symbolLabel({ type: 'resistor', params: { resistance: 2200 } }));
  check('芯片标签显示型号',
    S.symbolLabel({ type: 'ic74xx', params: { type: '74LS00' } }) === '74LS00',
    S.symbolLabel({ type: 'ic74xx', params: { type: '74LS00' } }));
  check('旧存档型号在符号上也归一化',
    S.symbolLabel({ type: 'ic74xx', params: { type: '7408' } }) === '74LS08',
    S.symbolLabel({ type: 'ic74xx', params: { type: '7408' } }));
}

/* ---------------------------------------------------------------- 原理图布线 */
{
  const SR = await import('../js/symrender.js');

  const comp = (id, type, rotation = 0) => ({
    id, type, x: 0, y: 0, rotation, params: {}, terminals: [],
  });

  // ① 两端同水平 → 一条直线（1 段 2 点）
  {
    const circuit = {
      components: [comp('r1', 'resistor'), comp('r2', 'resistor')],
      wires: [{ id: 'w1', a: { componentId: 'r1', terminal: '2' }, b: { componentId: 'r2', terminal: '1' } }],
    };
    const layout = new Map([
      ['r1', { sx: 0, sy: 0 }],
      ['r2', { sx: 10, sy: 0 }],
    ]);
    const netlist = {
      nets: new Map([['net1', [
        { componentId: 'r1', terminal: '2' },
        { componentId: 'r2', terminal: '1' },
      ]]]),
      netOf: new Map([['c:r1:2', 'net1'], ['c:r2:1', 'net1']]),
    };
    const links = SR.computeLinks(circuit, layout, netlist);
    check('同高两端布一条直线', links.length === 1 && links[0].segments.length === 1,
      JSON.stringify(links.map((l) => l.segments.length)));
    check('直线只有两个端点', links[0].segments[0].length === 2,
      String(links[0].segments[0].length));
    check('连线归属到具体导线', links[0].wireId === 'w1', String(links[0].wireId));
    check('直线两端 y 相同', links[0].segments[0][0].y === links[0].segments[0][1].y,
      JSON.stringify(links[0].segments[0]));

    // ② 不同高 → Z 形正交折线（4 点，全为水平/垂直段）
    const layout2 = new Map([
      ['r1', { sx: 0, sy: 0 }],
      ['r2', { sx: 10, sy: 5 }],
    ]);
    const links2 = SR.computeLinks(circuit, layout2, netlist);
    const pts = links2[0].segments[0];
    check('错位两端布 Z 形折线', pts.length === 4, String(pts.length));
    const allOrtho = pts.every((pt, i) => i === 0
      || Math.abs(pt.x - pts[i - 1].x) < 1e-9
      || Math.abs(pt.y - pts[i - 1].y) < 1e-9);
    check('折线每段都水平或垂直', allOrtho, JSON.stringify(pts));
    // 期望值按符号定义推导，避免符号尺寸调整后断言失效
    const SY = await import('../js/symparts.js');
    const pinY = SY.getSymbol('resistor').size.h / 2;
    check('折线首尾贴合引脚',
      pts[0].x === 4 && Math.abs(pts[0].y - pinY) < 1e-9
      && pts[3].x === 10 && Math.abs(pts[3].y - (5 + pinY)) < 1e-9,
      `${JSON.stringify(pts[0])} → ${JSON.stringify(pts[3])}，引脚 y=${pinY}`);
  }

  // ③ 三端同网 → 垂直主干 + 水平支线
  {
    const circuit = {
      components: [comp('r1', 'resistor'), comp('r2', 'resistor'), comp('r3', 'resistor')],
      wires: [
        { id: 'w1', a: { componentId: 'r1', terminal: '2' }, b: { componentId: 'r2', terminal: '1' } },
        { id: 'w2', a: { componentId: 'r2', terminal: '2' }, b: { componentId: 'r3', terminal: '1' } },
      ],
    };
    const layout = new Map([
      ['r1', { sx: 0, sy: 0 }],
      ['r2', { sx: 0, sy: 4 }],
      ['r3', { sx: 0, sy: 8 }],
    ]);
    const members = [
      { componentId: 'r1', terminal: '2' },
      { componentId: 'r2', terminal: '1' },
      { componentId: 'r3', terminal: '1' },
    ];
    const netlist = {
      nets: new Map([['net1', members]]),
      netOf: new Map([
        ['c:r1:2', 'net1'], ['c:r2:1', 'net1'], ['c:r3:1', 'net1'],
      ]),
    };
    const links = SR.computeLinks(circuit, layout, netlist);
    check('三端只产生一条连接', links.length === 1, String(links.length));
    check('三端连接挂着 3 个端子', links[0].terms.length === 3, String(links[0].terms.length));
    check('三端走主干布线（≥1 段）', links[0].segments.length >= 1,
      String(links[0].segments.length));
    const vertical = links[0].segments.some((seg) => seg.length === 2
      && Math.abs(seg[0].x - seg[1].x) < 1e-9
      && Math.abs(seg[0].y - seg[1].y) > 1e-9);
    check('三端含一条垂直主干', vertical,
      JSON.stringify(links[0].segments.map((s) => s.length)));
  }

  // ④ 缺 layout 的元件不参与布线（不应崩、不应画错位线）
  {
    const circuit = {
      components: [comp('r1', 'resistor'), comp('r2', 'resistor')],
      wires: [],
    };
    const netlist = {
      nets: new Map([['net1', [
        { componentId: 'r1', terminal: '1' },
        { componentId: 'r2', terminal: '1' },
      ]]]),
      netOf: new Map(),
    };
    const links = SR.computeLinks(circuit, new Map([['r1', { sx: 0, sy: 0 }]]), netlist);
    check('缺布局时不产生半截连线', links.length === 0, String(links.length));
  }

  // ⑤ 空电路
  {
    const links = SR.computeLinks({ components: [], wires: [] }, new Map(), { nets: new Map(), netOf: new Map() });
    check('空电路无连线', links.length === 0, String(links.length));
  }
}

/* ---------------------------------------------------------------- 仿真内核：线性代数 */
{
  // ① 3×3 唯一解 [2, 3, -1]
  //   2x +  y −  z = 8
  //    x + 3y + 2z = 9
  //   −x + 2y + 4z = 0   （det = 5，非奇异）
  const n = 3;
  const A = S.makeMatrix(n);
  const b = S.makeVector(n);
  [[2, 1, -1, 8], [1, 3, 2, 9], [-1, 2, 4, 0]].forEach((row, i) => {
    S.stampAdd(A, n, i, 0, row[0]);
    S.stampAdd(A, n, i, 1, row[1]);
    S.stampAdd(A, n, i, 2, row[2]);
    S.stampRhs(b, n, i, row[3]);
  });
  const solved = S.solveLinear(A, b, n);
  check('3×3 线性方程组求解成功', solved.ok === true, solved.error || '');
  check('解与手算一致 [2, 3, -1]',
    solved.ok
      && Math.abs(solved.x[0] - 2) < 1e-12
      && Math.abs(solved.x[1] - 3) < 1e-12
      && Math.abs(solved.x[2] + 1) < 1e-12,
    solved.ok ? [...solved.x].map((v) => v.toFixed(9)).join(', ') : '');

  // ② 奇异矩阵：三行相同（秩 1）→ 必须报错，不能返回 1e18 量级垃圾解
  const singular = S.makeMatrix(3);
  const sb = S.makeVector(3);
  for (let i = 0; i < 3; i += 1) {
    S.stampAdd(singular, 3, i, 0, 1);
    S.stampAdd(singular, 3, i, 1, 1);
    S.stampAdd(singular, 3, i, 2, 1);
    S.stampRhs(sb, 3, i, i + 1);
  }
  const snapshot = Array.from(singular);
  const bad = S.solveLinear(singular, sb, 3);
  check('奇异矩阵被识别（返回失败）', bad.ok === false, JSON.stringify(bad.x || bad.error));
  check('奇异信息可读', typeof bad.error === 'string' && bad.error.includes('奇异'), bad.error);
  check('求解不改动入参矩阵（内部先复制）',
    snapshot.every((v, i) => v === singular[i]), '');

  // ③ 牛顿法解 x²−2 = 0 → √2（J 必须是行主序扁平矩阵）
  const rootIterate = (x) => {
    const J = S.makeMatrix(1);
    S.stampAdd(J, 1, 0, 0, 2 * x[0]);
    return { F: Float64Array.from([x[0] * x[0] - 2]), J };
  };
  const root = S.newtonSolve([1], rootIterate, { maxIter: 20, tol: 1e-12 });
  check('牛顿法收敛到 √2',
    root.ok && Math.abs(root.x[0] - Math.SQRT2) < 1e-12,
    root.ok ? `${root.x[0]}（${root.iter} 轮）` : String(root.error));
  check('牛顿法二次收敛（≤ 8 轮）', root.ok && root.iter <= 8, String(root.iter));

  // ④ 无实根 x²+1 = 0 → 必须报不收敛，而不是给出一个"看起来正常"的解
  const noRoot = S.newtonSolve([0.5], (x) => {
    const J = S.makeMatrix(1);
    S.stampAdd(J, 1, 0, 0, 2 * x[0]);
    return { F: Float64Array.from([x[0] * x[0] + 1]), J };
  }, { maxIter: 30 });
  check('无实根时返回不收敛',
    noRoot.ok === false && noRoot.reason === 'maxIter',
    `${noRoot.reason} residual=${noRoot.residual}`);

  // ⑤ 迭代函数返回嵌套数组时应给出明确错误，而不是含糊的「不收敛」
  const wrongShape = S.newtonSolve([1], () => ({ F: [1], J: [[2]] }), { maxIter: 3 });
  check('雅可比形状错误被明确指出',
    wrongShape.ok === false && wrongShape.reason === 'shape', String(wrongShape.error));
}

/* ---------------------------------------------------------------- 仿真内核：元件模型 */
{
  const types = P2.PART_ORDER;
  const DIG = await import('../js/digmodels.js');
  // 包 6 起元件库分两个域：数字域（7 种 IC + 逻辑开关/脉冲/时钟）与模拟域。
  // 每个类型必须**只**归一侧：数字元件不参与 MNA，模拟元件不参与三值求值。
  check('每个元件类型只归属模拟或数字一侧',
    types.every((t) => (DIG.isDigital(t)
      ? !D.hasModel(t)
      : (D.hasModel(t) || D.isSkipped(t)))),
    types.filter((t) => (DIG.isDigital(t) ? D.hasModel(t) : (!D.hasModel(t) && !D.isSkipped(t)))).join(','));
  check('数字域覆盖 7 种 IC + 3 个数字源',
    DIG.DIG_MODEL_ORDER.length === 7 && Object.keys(DIG.DIG_SOURCES).length === 3,
    `${DIG.DIG_MODEL_ORDER.length}+${Object.keys(DIG.DIG_SOURCES).length}`);
  check('数字元件 74 系列是「有意跳过」而非「缺模型」',
    D.hasModel('ic74xx') === false && D.isSkipped('ic74xx') === true, D.modelNote('ic74xx'));
  check('模拟元件都有模型且未被跳过',
    types.filter((t) => !DIG.isDigital(t)).every((t) => D.hasModel(t) && !D.isSkipped(t)),
    types.filter((t) => !DIG.isDigital(t)).join(','));

  // 电阻 / 电容 / 开关的线性属性
  check('电阻不占额外支路未知量', D.needsBranch('resistor') === false, '');
  check('电压源需要支路电流未知量', D.needsBranch('vsource') === true, '');
  check('电流源不需要支路未知量', D.needsBranch('isource') === false, '');
  check('电容直流不导通', D.conductsDC('capacitor', {}) === false, D.modelNote('capacitor'));
  check('开关闭合导通', D.conductsDC('switch', { state: 'closed' }) === true, '');
  check('开关断开不导通', D.conductsDC('switch', { state: 'open' }) === false, '');
  check('开关导通电阻为 1μΩ 量级（不是 0，避免矩阵奇异）',
    D.SWITCH_RON > 0 && D.SWITCH_RON <= 1e-5, String(D.SWITCH_RON));

  // LED 指数模型：单调 + 反向截止 + 限幅器
  const i06 = D.ledCurrent(0.6);
  const i07 = D.ledCurrent(0.7);
  const i13 = D.ledCurrent(1.3);
  check('LED 指数模型单调递增', i07 > i06 && i13 > i07,
    `${i06.toExponential(2)} / ${i07.toExponential(2)} / ${i13.toExponential(2)}`);
  check('LED 反向电流 ≈ 0（|I| < 1pA）', Math.abs(D.ledCurrent(-5)) < 1e-12,
    D.ledCurrent(-5).toExponential(2));
  check('LED 在 nVt 尺度上符合 Is·e^(Vd/nVt)',
    Math.abs(D.ledCurrent(0.74) - D.LED_IS * (Math.exp(0.74 / D.LED_VT) - 1)) < 1e-12, '');
  // 结电压限制器：vlim = vcrit + nVt·ln(1 + (vd−vcrit)/nVt)，把 5V 一步压到 1V 以内
  const lim5 = D.limitJunction(5);
  check('LED 结电压限制器把 5V 大步长压到 vcrit 附近（1V 以内）',
    lim5 > D.LED_VCRIT && lim5 < 1,
    `${lim5.toFixed(4)}V（vcrit=${D.LED_VCRIT.toFixed(4)}V，nVt=${D.LED_VT.toFixed(5)}）`);
  check('限制器对小电压不生效', Math.abs(D.limitJunction(0.6) - 0.6) < 1e-12,
    String(D.limitJunction(0.6)));
  check('LED 电压↔电流互逆（10mA → Vd → 10mA）',
    Math.abs(D.ledCurrent(D.ledVoltageAt(0.01)) - 0.01) < 1e-9,
    String(D.ledCurrent(D.ledVoltageAt(0.01))));

  // 参数校验
  check('非法电阻值被拦下', D.validateParams('resistor', { resistance: 0 }) !== null,
    D.validateParams('resistor', { resistance: 0 }));
  check('非法开关状态被拦下', D.validateParams('switch', { state: '半开' }) !== null,
    D.validateParams('switch', { state: '半开' }));
}

/* ---------------------------------------------------------------- 仿真内核：直流求解 */
{
  /** 建一个电路并求解；build 里用 M.* 直接搭 */
  const solveWith = (build, label) => {
    M.createCircuit('exp-box');
    const built = build();
    const result = SIM.solveDC(M);
    result.__ids = built;
    result.__label = label;
    return result;
  };

  // ① 分压：5V → 1k → 2k → 地，中点 1.6667V？不对，是 3.333V（2k 在下方）
  const divider = solveWith(() => {
    const vs = M.addComponent('vsource', 2, 2).component;
    const r1 = M.addComponent('resistor', 6, 2).component;
    const r2 = M.addComponent('resistor', 10, 2).component;
    M.updateParams(r1.id, { resistance: 1000 });
    M.updateParams(r2.id, { resistance: 2000 });
    M.addWire({ componentId: vs.id, terminal: '+' }, { componentId: r1.id, terminal: '1' });
    M.addWire({ componentId: r1.id, terminal: '2' }, { componentId: r2.id, terminal: '1' });
    M.addWire({ componentId: r2.id, terminal: '2' }, { componentId: vs.id, terminal: '-' });
    return { vs, r1, r2 };
  }, 'divider');
  const mid = divider.nodeVoltages.find((n) => !n.grounded && Math.abs(n.v - 5) > 1e-9);
  check('分压电路求解成功', divider.ok === true, String(divider.error));
  check('分压中点 5×2k/(1k+2k) = 3.333V（误差 < 1e-3）',
    Boolean(mid) && Math.abs(mid.v - 10 / 3) < 1e-3,
    mid ? `${mid.v.toFixed(6)}V` : '找不到中点');
  check('分压电流 1.667mA', Math.abs(
    divider.elementResults.find((e) => e.componentId === 'resistor-1').i - 0.005 / 3,
  ) < 1e-9, divider.elementResults.map((e) => `${e.componentId}=${(e.i * 1000).toFixed(4)}mA`).join(' '));
  check('KCL：电源电流 = −负载电流',
    Math.abs(
      divider.elementResults.find((e) => e.type === 'vsource').i
      + divider.elementResults.find((e) => e.type === 'resistor').i,
    ) < 1e-12, divider.elementResults.map((e) => `${e.componentId}=${e.i.toExponential(3)}`).join(' '));
  check('电阻功率 = I²R（1k 上 2.78mW）',
    Math.abs(divider.elementResults.find((e) => e.componentId === 'resistor-1').power - (1 / 600) ** 2 * 1000) < 1e-9,
    String(divider.elementResults.find((e) => e.componentId === 'resistor-1').power));

  // ② 短路：电源正负端被导线直连
  const shorted = solveWith(() => {
    const vs = M.addComponent('vsource', 2, 5).component;
    M.addWire({ componentId: vs.id, terminal: '+' }, { componentId: vs.id, terminal: '-' });
    return { vs };
  }, 'short');
  check('电源直连被判为短路', shorted.ok === false && String(shorted.error).includes('短路'),
    String(shorted.error));

  // ③ 开关断开 → 零电流；闭合 → 5mA
  const makeSwitch = (state) => solveWith(() => {
    const vs = M.addComponent('vsource', 2, 8).component;
    const sw = M.addComponent('switch', 6, 8).component;
    const r = M.addComponent('resistor', 10, 8).component;
    M.updateParams(r.id, { resistance: 1000 });
    M.updateParams(sw.id, { state });
    M.addWire({ componentId: vs.id, terminal: '+' }, { componentId: sw.id, terminal: 'COM' });
    M.addWire({ componentId: sw.id, terminal: 'NO' }, { componentId: r.id, terminal: '1' });
    M.addWire({ componentId: r.id, terminal: '2' }, { componentId: vs.id, terminal: '-' });
    return { vs, sw, r };
  }, 'switch-' + state);

  const swOpen = makeSwitch('open');
  const swClosed = makeSwitch('closed');
  const openI = swOpen.ok ? swOpen.elementResults.find((e) => e.type === 'resistor').i : NaN;
  const closedI = swClosed.ok ? swClosed.elementResults.find((e) => e.type === 'resistor').i : NaN;
  check('开关断开：求解成功且电流为 0', swOpen.ok === true && Math.abs(openI) < 1e-9,
    `I=${openI}`);
  check('开关断开：全部压降落在开关上（5V）',
    Math.abs(swOpen.elementResults.find((e) => e.type === 'switch').v - 5) < 1e-9,
    `${swOpen.elementResults.find((e) => e.type === 'switch').v}V`);
  check('开关闭合：电流 5V/1k = 5mA', swClosed.ok === true && Math.abs(closedI - 0.005) < 1e-9,
    `${(closedI * 1000).toFixed(6)}mA`);

  // ④ LED：5V-220Ω-LED，NR 收敛且电流为 mA 量级
  const ledSim = solveWith(() => {
    const vs = M.addComponent('vsource', 2, 11).component;
    const r = M.addComponent('resistor', 6, 11).component;
    const d = M.addComponent('led', 10, 11).component;
    M.updateParams(r.id, { resistance: 220 });
    M.addWire({ componentId: vs.id, terminal: '+' }, { componentId: r.id, terminal: '1' });
    M.addWire({ componentId: r.id, terminal: '2' }, { componentId: d.id, terminal: 'A' });
    M.addWire({ componentId: d.id, terminal: 'K' }, { componentId: vs.id, terminal: '-' });
    return { vs, r, d };
  }, 'led');
  const led = ledSim.elementResults.find((e) => e.type === 'led');
  check('LED 电路收敛', ledSim.ok === true, String(ledSim.error));
  check('LED NR 迭代 ≤ 20 次', ledSim.convergence.iter <= 20, String(ledSim.convergence.iter));
  check('LED 压降落在 0.65~0.8V（n=1 理想二极管 + Is=1e-14）',
    led && led.v > 0.65 && led.v < 0.8, led ? `${led.v.toFixed(4)}V` : '');
  check('LED 电流为 mA 量级', led && led.i > 1e-3 && led.i < 1e-1,
    led ? `${(led.i * 1000).toFixed(3)}mA` : '');
  check('LED 上 KCL 成立（电源电流 = −LED 电流）',
    Math.abs(ledSim.elementResults.find((e) => e.type === 'vsource').i + led.i) < 1e-9, '');

  // ⑤ 电容直流开路 + 悬空网段只告警
  const capSim = solveWith(() => {
    const vs = M.addComponent('vsource', 2, 14).component;
    const c = M.addComponent('capacitor', 6, 14).component;
    M.addWire({ componentId: vs.id, terminal: '+' }, { componentId: c.id, terminal: '1' });
    M.addWire({ componentId: c.id, terminal: '2' }, { componentId: vs.id, terminal: '-' });
    return { vs, c };
  }, 'cap');
  const cap = capSim.elementResults.find((e) => e.type === 'capacitor');
  check('电容在直流下标注开路且电流为 0',
    capSim.ok === true && cap.i === 0 && cap.note === '直流开路',
    cap ? `I=${cap.i} note=${cap.note}` : '无电容结果');

  const floatSim = solveWith(() => {
    const vs = M.addComponent('vsource', 2, 17).component;
    const r1 = M.addComponent('resistor', 6, 17).component;
    const r2 = M.addComponent('resistor', 10, 17).component;
    M.addWire({ componentId: vs.id, terminal: '+' }, { componentId: r1.id, terminal: '1' });
    M.addWire({ componentId: r1.id, terminal: '2' }, { componentId: vs.id, terminal: '-' });
    // r2 两端自成孤岛，与地不连通
    M.addWire({ componentId: r2.id, terminal: '1' }, { componentId: r2.id, terminal: '2' });
    return { vs, r1, r2 };
  }, 'float');
  check('未接地网段不报错、只给告警',
    floatSim.ok === true && floatSim.warnings.some((w) => w.includes('未接地')),
    JSON.stringify(floatSim.warnings));

  // ⑥ 性能：21 元件串阻链单次求解 < 10ms（元件按 36×20 网格分三行摆放）
  M.createCircuit('exp-box');
  {
    const count = 20;
    const prev = M.addComponent('vsource', 1, 1).component;
    const chain = [];
    for (let i = 0; i < count; i += 1) {
      const col = i % 8;
      const row = Math.floor(i / 8);
      const placed = M.addComponent('resistor', 2 + col * 4, 2 + row * 3);
      if (!placed.ok) {
        check(`串阻链第 ${i + 1} 个元件放置成功`, false, JSON.stringify(placed));
      }
      chain.push(placed.component);
    }
    M.addWire({ componentId: prev.id, terminal: '+' }, { componentId: chain[0].id, terminal: '1' });
    for (let i = 0; i < count - 1; i += 1) {
      M.addWire({ componentId: chain[i].id, terminal: '2' }, { componentId: chain[i + 1].id, terminal: '1' });
    }
    M.addWire({ componentId: chain[count - 1].id, terminal: '2' }, { componentId: prev.id, terminal: '-' });

    const samples = [];
    let perfResult = null;
    for (let i = 0; i < 11; i += 1) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      perfResult = SIM.solveDC(M);
      samples.push((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    }
    samples.sort((a, b) => a - b);
    check('20 串阻链求解成功', perfResult.ok === true, String(perfResult.error));
    check('单次求解 < 10ms', samples[5] < 10, `median=${samples[5].toFixed(3)}ms`);
    check('串阻电流 = 5V/20k = 0.25mA',
      Math.abs(perfResult.elementResults.find((e) => e.type === 'resistor').i - 0.00025) < 1e-9,
      `${(perfResult.elementResults.find((e) => e.type === 'resistor').i * 1000).toFixed(6)}mA`);
  }

  // ⑦ 格式化函数只用一份实现
  check('formatVolt 保留 3 位小数', SIM.formatVolt(3.33333) === '3.333 V', SIM.formatVolt(3.33333));
  check('formatAmp 自动切 mA', SIM.formatAmp(0.016774) === '16.77 mA', SIM.formatAmp(0.016774));
  check('formatWatt 自动切 mW', SIM.formatWatt(0.005556) === '5.56 mW', SIM.formatWatt(0.005556));
  check('formatVolt 处理 null/NaN', SIM.formatVolt(null) === '—' && SIM.formatVolt(NaN) === '—', '');
  check('formatResidual 对精确 0 写 0', SIM.formatResidual(0) === '0', SIM.formatResidual(0));
  check('formatResidual 对极小值用科学计数', SIM.formatResidual(1.1e-16) === '1.1e-16',
    SIM.formatResidual(1.1e-16));
}

/* ---------------------------------------------------------------- 数字域：元件与封装 */
{
  const DG = await import('../js/digmodels.js');
  const P3 = P2.PARTS;

  const ic = P3.ic74xx;
  check('74LS 芯片 14 个端子', ic.terminals.length === 14, String(ic.terminals.length));
  const names = ic.terminals.map((t) => t.name);
  check('14 个引脚名互不相同', new Set(names).size === 14, names.join(','));

  const byName = new Map(ic.terminals.map((t) => [t.name, t]));
  check('DIP-14：7 脚 = GND', byName.get('7').role === 'GND', String(byName.get('7').role));
  check('DIP-14：14 脚 = VCC', byName.get('14').role === 'VCC', String(byName.get('14').role));
  check('7 / 14 脚标为 power 方向',
    byName.get('7').direction === 'power' && byName.get('14').direction === 'power',
    `${byName.get('7').direction}/${byName.get('14').direction}`);
  check('其余 12 个脚不再冒充电源脚',
    ic.terminals.filter((t) => t.role !== 'GND' && t.role !== 'VCC').every((t) => t.role === 'io'), '');

  const options = ic.paramFields[0].options.map((option) => option.value);
  check('型号下拉覆盖七种芯片', options.length === 7 && options.every((id) => DG.DIG_MODELS[id]),
    options.join(','));
  check('下拉顺序与 digmodels 完全一致',
    options.length === DG.DIG_MODEL_ORDER.length
    && options.every((id, index) => id === DG.DIG_MODEL_ORDER[index]), options.join(','));
  check('旧存档型号 7408 仍能归一化', DG.normalizeType('7408') === '74LS08', DG.normalizeType('7408'));
  check('74hc00 也归一化到 74LS00', DG.normalizeType('74hc00') === '74LS00', DG.normalizeType('74hc00'));

  // 每种芯片的引脚表都必须覆盖 1..14，且每个门的输出脚确实是 out
  DG.DIG_MODEL_ORDER.forEach((id) => {
    const model = DG.DIG_MODELS[id];
    const pins = Object.keys(model.pins).sort((a, b) => Number(a) - Number(b));
    check(`${id} 引脚表覆盖 1..14`,
      pins.length === 14 && pins.every((pin, index) => Number(pin) === index + 1), pins.join(','));
    check(`${id} 每个门的输出脚都标成 out`,
      model.units.every((unit) => unit.outputs.every((pin) => model.pins[pin] && model.pins[pin].dir === 'out')), '');
    check(`${id} 电源脚固定 7=GND / 14=VCC`,
      model.power.gnd === '7' && model.power.vcc === '14', `${model.power.gnd}/${model.power.vcc}`);
  });

  check('74LS00 四个门共 4 个单元', DG.DIG_MODELS['74LS00'].units.length === 4, '');
  check('74LS04 六个反相器共 6 个单元', DG.DIG_MODELS['74LS04'].units.length === 6, '');
  check('74LS74 双触发器共 2 个单元', DG.DIG_MODELS['74LS74'].units.length === 2, '');

  ['logic-switch', 'pulse', 'clock'].forEach((type) => {
    const def = P3[type];
    check(`${type} 已注册`, Boolean(def), '');
    check(`${type} 有可编辑参数`, def.paramFields.length > 0, '');
  });
  check('逻辑开关只有 OUT 一个端子',
    P3['logic-switch'].terminals.map((t) => t.name).join(',') === 'OUT', '');
  check('脉冲源端子为 + / -', P3.pulse.terminals.map((t) => t.name).join(',') === '+,-', '');
  check('时钟源端子为 + / GND', P3.clock.terminals.map((t) => t.name).join(',') === '+,GND', '');
  check('时钟源可调频率与占空比',
    P3.clock.paramFields.map((f) => f.key).join(',') === 'frequency,duty', '');
  check('逻辑开关默认低电平', P3['logic-switch'].defaultParams.state === 'lo', '');
}

/* ---------------------------------------------------------------- 数字域：逻辑模型 */
{
  const DG = await import('../js/digmodels.js');
  const M00 = DG.DIG_MODELS['74LS00'];

  // ① 74LS00 真值表逐项（含四个门分别抽查）
  [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]].forEach(([a, b, y]) => {
    const got = M00.units[0].fn({ 1: a, 2: b })[3];
    check(`74LS00 ${a}${b} → ${y}`, got === y, String(got));
  });
  check('74LS00 X1 → X', M00.units[0].fn({ 1: 'X', 2: 1 })[3] === 'X', '');
  check('74LS00 X0 → 1（0 输入决定与门）', M00.units[0].fn({ 1: 'X', 2: 0 })[3] === 1, '');
  [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]].forEach(([a, b, y], index) => {
    const unit = M00.units[index];
    const got = unit.fn({ [a]: 1, [b]: 1 })[y];
    check(`74LS00 第 ${index + 1} 个门 11 → 0`, got === 0, `${a}${b}→${y} got ${got}`);
  });

  // ② 74LS04
  const M04 = DG.DIG_MODELS['74LS04'];
  check('74LS04 0 → 1', M04.units[0].fn({ 1: 0 })[2] === 1, '');
  check('74LS04 1 → 0', M04.units[0].fn({ 1: 1 })[2] === 0, '');
  check('74LS04 X → X', M04.units[0].fn({ 1: 'X' })[2] === 'X', '');
  check('74LS04 六个反相器各自的脚位',
    M04.units.every((unit) => M04.pins[unit.inputs[0]] && M04.pins[unit.outputs[0]]), '');

  // ③ 其余四种门（每型四行真值表）
  const TABLES = {
    '74LS02': [[0, 0, 1], [0, 1, 0], [1, 0, 0], [1, 1, 0]],
    '74LS08': [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 1]],
    '74LS32': [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]],
    '74LS86': [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]],
  };
  Object.keys(TABLES).forEach((id) => {
    const unit = DG.DIG_MODELS[id].units[0];
    const [aPin, bPin] = unit.inputs;
    const yPin = unit.outputs[0];
    TABLES[id].forEach(([a, b, y]) => {
      const got = unit.fn({ [aPin]: a, [bPin]: b })[yPin];
      check(`${id} ${a}${b} → ${y}`, got === y, String(got));
    });
    // X 传播要看"配哪个确定值"：与门配 1 才未知，或门配 0 才未知；
    // 配到主导输入（与门 0 / 或门 1）时输出是确定的，这才是三值逻辑该有的样子。
    const neutral = (id === '74LS02' || id === '74LS32') ? 0 : 1;
    check(`${id} X 配 ${neutral} → X`,
      unit.fn({ [aPin]: 'X', [bPin]: neutral })[yPin] === 'X', '');
    const dominant = neutral === 0 ? 1 : 0;
    // 异或没有"主导输入"：X XOR 0 仍然是 X，所以只有与/或族才检查这一条
    if (id !== '74LS86') {
      check(`${id} X 配 ${dominant} → 被主导输入决定`,
        unit.fn({ [aPin]: 'X', [bPin]: dominant })[yPin] !== 'X', '');
    }
  });

  // ④ 74LS74 边沿与异步
  const ff = DG.DIG_MODELS['74LS74'].units[0];
  const idle = ff.fn({ 1: 1, 4: 1, 2: 1, 3: 0 }, { q: 0, clk: 0 });
  check('74LS74 无时钟沿时 D=1 不改变 Q', idle.outputs[5] === 0 && idle.edge === false, JSON.stringify(idle.outputs));
  const rise = ff.fn({ 1: 1, 4: 1, 2: 1, 3: 1 }, idle.state);
  check('74LS74 上升沿采样 D=1 → Q=1', rise.outputs[5] === 1 && rise.edge === true, '');
  check('74LS74 Q 与 Q̅ 互补', rise.outputs[5] === 1 && rise.outputs[6] === 0, '');
  const hold = ff.fn({ 1: 1, 4: 1, 2: 0, 3: 1 }, rise.state);
  check('74LS74 时钟保持高时 D 变化不影响 Q', hold.outputs[5] === 1 && hold.edge === false, '');
  const fall = ff.fn({ 1: 1, 4: 1, 2: 0, 3: 0 }, hold.state);
  const rise2 = ff.fn({ 1: 1, 4: 1, 2: 0, 3: 1 }, fall.state);
  check('74LS74 第二个上升沿采样 D=0 → Q=0', rise2.outputs[5] === 0, '');
  const preset = ff.fn({ 1: 1, 4: 0, 2: 0, 3: 0 }, { q: 0, clk: 0 });
  check('74LS74 PRE=0 → Q=1（无视时钟）', preset.outputs[5] === 1 && preset.mode === 'preset', preset.mode);
  const clear = ff.fn({ 1: 0, 4: 1, 2: 1, 3: 1 }, { q: 1, clk: 0 });
  check('74LS74 CLR=0 → Q=0（无视时钟）', clear.outputs[5] === 0 && clear.mode === 'clear', clear.mode);
  const both = ff.fn({ 1: 0, 4: 0, 2: 1, 3: 1 }, { q: 0, clk: 0 });
  check('74LS74 PRE=CLR=0 → Q=Q̅=1（不稳定态）',
    both.outputs[5] === 1 && both.outputs[6] === 1 && both.invalid === true, JSON.stringify(both.outputs));
  const dX = ff.fn({ 1: 1, 4: 1, 2: 'X', 3: 1 }, { q: 0, clk: 0 });
  check('74LS74 采样到 X → Q=X', dX.outputs[5] === 'X', String(dX.outputs[5]));

  // ⑤ 阈值
  check('3.3V → 判 1', DG.levelFromVoltage(3.3) === 1, '');
  check('0.2V → 判 0', DG.levelFromVoltage(0.2) === 0, '');
  check('1.5V → 判 X（阈值之间）', DG.levelFromVoltage(1.5) === 'X', '');
  check('null → X', DG.levelFromVoltage(null) === 'X', '');
  check('电平回映射电压 1→5V / 0→0V / X→2.5V',
    DG.voltageOfLevel(1) === 5 && DG.voltageOfLevel(0) === 0 && DG.voltageOfLevel('X') === 2.5, '');
}

/* ---------------------------------------------------------------- 数字仿真引擎 */
{
  const DG = await import('../js/digmodels.js');
  const SD = await import('../js/simdig.js');

  const addSwitch = (x, y, state = 'lo') => {
    const r = M.addComponent('logic-switch', x, y, { params: { state } });
    if (!r.ok) throw new Error(r.error);
    return r.component;
  };
  const addIc = (x, y, type) => {
    const r = M.addComponent('ic74xx', x, y, { params: { type } });
    if (!r.ok) throw new Error(r.error);
    return r.component;
  };
  const wire = (a, at, b, bt) => M.addWire(
    { componentId: a.id, terminal: at },
    { componentId: b.id, terminal: bt },
  );
  const pinOf = (result, id, pin) => {
    const record = result.compStates.find((item) => item.componentId === id);
    return record ? record.outputs[pin] : undefined;
  };

  // ① 逻辑开关 → 74LS00（真值表）
  M.createCircuit('exp-box');
  SD.resetDigState();
  const sa = addSwitch(2, 12, 'hi');
  const sb = addSwitch(6, 12, 'lo');
  const g1 = addIc(2, 2, '74LS00');
  wire(sa, 'OUT', g1, '1');
  wire(sb, 'OUT', g1, '2');
  let dig = SD.solveDig(M);
  check('数字求值成功', dig.ok === true, String(dig.error));
  check('开关 hi/lo → 1Y = 1', pinOf(dig, g1.id, '3') === 1, String(pinOf(dig, g1.id, '3')));

  M.updateParams(sb.id, { state: 'hi' });
  dig = SD.solveDig(M);
  check('开关 hi/hi → 1Y = 0', pinOf(dig, g1.id, '3') === 0, String(pinOf(dig, g1.id, '3')));

  // ② 级联 74LS00 → 74LS04
  const g2 = addIc(12, 2, '74LS04');
  wire(g1, '3', g2, '1');
  dig = SD.solveDig(M);
  check('级联：NAND=0 → NOT=1', pinOf(dig, g2.id, '2') === 1, String(pinOf(dig, g2.id, '2')));

  // ③ 组合环路
  M.createCircuit('exp-box');
  SD.resetDigState();
  const l1 = addIc(2, 2, '74LS00');
  const l2 = addIc(12, 2, '74LS00');
  wire(l1, '3', l2, '1');
  wire(l2, '3', l1, '1');
  dig = SD.solveDig(M);
  check('组合环路被检出', dig.ok === false && dig.error === '检测到组合逻辑环路（请检查连线）', String(dig.error));
  check('环路列出了环上元件', dig.cycle.length >= 2, JSON.stringify(dig.cycle));

  M.createCircuit('exp-box');
  SD.resetDigState();
  const self = addIc(2, 2, '74LS00');
  wire(self, '3', self, '1');
  dig = SD.solveDig(M);
  check('同一片芯片自环也能检出', dig.ok === false, String(dig.error));

  // ④ 驱动竞争
  M.createCircuit('exp-box');
  SD.resetDigState();
  const c1 = addIc(2, 2, '74LS00');
  const c2 = addIc(12, 2, '74LS00');
  wire(c1, '3', c2, '3');
  dig = SD.solveDig(M);
  check('两门接同一网 → 驱动竞争告警',
    dig.warnings.some((text) => text.includes('驱动竞争')), JSON.stringify(dig.warnings));
  check('竞争网被标记', dig.conflicts.length === 1, JSON.stringify(dig.conflicts));

  // ⑤ 时钟步进：74LS74
  M.createCircuit('exp-box');
  SD.resetDigState();
  const dsw = addSwitch(2, 16, 'hi');
  const clk = M.addComponent('clock', 10, 16, { params: { frequency: 1, duty: 50 } }).component;
  const f1 = addIc(2, 6, '74LS74');
  wire(dsw, 'OUT', f1, '2');
  wire(clk, '+', f1, '3');
  dig = SD.solveDig(M);
  check('触发器初始 Q=0', pinOf(dig, f1.id, '5') === 0, String(pinOf(dig, f1.id, '5')));
  const stepped = SD.stepClock(M);
  check('时钟步进成功', stepped.ok === true, String(stepped.error));
  dig = SD.solveDig(M);
  check('步进后 Q=1（上升沿采样 D=hi）', pinOf(dig, f1.id, '5') === 1, String(pinOf(dig, f1.id, '5')));
  M.updateParams(dsw.id, { state: 'lo' });
  SD.stepClock(M);
  dig = SD.solveDig(M);
  check('D 改 lo 再步进 → Q=0', pinOf(dig, f1.id, '5') === 0, String(pinOf(dig, f1.id, '5')));

  // ⑥ 异步置位
  M.createCircuit('exp-box');
  SD.resetDigState();
  const prSw = addSwitch(2, 16, 'lo');
  const f2 = addIc(2, 6, '74LS74');
  wire(prSw, 'OUT', f2, '4');
  dig = SD.solveDig(M);
  check('PRE=0 → Q=1（不需要时钟）', pinOf(dig, f2.id, '5') === 1, String(pinOf(dig, f2.id, '5')));

  // ⑦ 门输出 → 220Ω → LED（与直流内核耦合）
  M.createCircuit('exp-box');
  SD.resetDigState();
  const src = M.addComponent('vsource', 2, 16, { params: { voltage: 5 } }).component;
  const gate = addIc(2, 2, '74LS00');
  const swA = addSwitch(2, 12, 'hi');
  const swB = addSwitch(6, 12, 'lo');
  wire(swA, 'OUT', gate, '1');
  wire(swB, 'OUT', gate, '2');
  wire(src, '+', gate, '14');
  wire(src, '-', gate, '7');
  const res = M.addComponent('resistor', 14, 2, { params: { resistance: 220 } }).component;
  const led = M.addComponent('led', 18, 2, { params: { color: 'red' } }).component;
  wire(gate, '3', res, '1');
  wire(res, '2', led, 'A');
  wire(led, 'K', gate, '7');

  const lit = SD.solveCoupled(M);
  check('耦合求解：直流侧成功', lit.analog.ok === true, String(lit.analog.error));
  check('耦合求解：数字侧输出 1', lit.dig.ok === true && pinOf(lit.dig, gate.id, '3') === 1, '');
  check('数字输出把 5V 灌进 LED 所在网', lit.activeDrives.length === 1 && lit.activeDrives[0].voltage === 5,
    JSON.stringify(lit.activeDrives));
  check('LED 判定为亮', lit.leds.length === 1 && lit.leds[0].on === true, JSON.stringify(lit.leds));
  check('LED 电流 mA 级（约 19.4mA）',
    lit.leds[0].i > 0.015 && lit.leds[0].i < 0.025, `${(lit.leds[0].i * 1000).toFixed(2)}mA`);
  check('注入用的假电源不出现在元件结果里',
    lit.analog.elementResults.every((item) => !String(item.componentId).startsWith(SD.DRIVE_PREFIX)),
    JSON.stringify(lit.analog.elementResults.map((item) => item.componentId)));
  check('数字驱动回灌后 KCL 仍成立（源电流 = 支路电流）',
    Math.abs(lit.analog.elementResults.filter((item) => item.type === 'resistor')[0].i
      - lit.leds[0].i) < 1e-9, '');

  M.updateParams(swB.id, { state: 'hi' });
  const dark = SD.solveCoupled(M);
  check('输出 0 时 LED 熄灭', dark.leds.length === 1 && dark.leds[0].on === false, JSON.stringify(dark.leds));

  // ⑧ 性能：96 个门
  M.createCircuit('breadboard');
  SD.resetDigState();
  const chips = [];
  for (let i = 0; i < 24; i += 1) {
    chips.push(addIc(2 + (i % 8) * 7, 2 + Math.floor(i / 8) * 4, '74LS00'));
  }
  for (let i = 0; i < chips.length - 1; i += 1) {
    wire(chips[i], '3', chips[i + 1], '1');
    wire(chips[i], '3', chips[i + 1], '2');
  }
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const big = SD.solveDig(M);
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  check('96 个门求值成功', big.ok === true && big.units.length === 96, `${big.units.length} units`);
  check('96 个门单次 < 5ms', ms < 5, `${ms.toFixed(2)}ms`);
}

/* ---------------------------------------------------------------- 汇总 */
console.log(`\n=== model 自测：${pass}/${pass + fail} 通过 ===`);
if (fail > 0) {
  console.log('未通过项：');
  failures.forEach((item) => console.log('  × ' + item));
  process.exitCode = 1;
}
