#!/usr/bin/env node
/* ============================================================
 * tools/gen-arcade.mjs —— 把脑力街机聚合页拆成「单游戏分片」
 * ------------------------------------------------------------
 * 背景：games/brain-gym/index.html 是上游整站（57 个玩法、555KB），
 *      其中 9 个街机（tetris / snake / mines / ...）从大厅直接直达。
 *      进任何一个都要先下完整聚合页，弱网下这是最大的单点瓶颈。
 *
 * 做法（不改上游一行）：
 *   games/brain-gym/brain-gym.html   聚合页原件（首屏 / 定级 / 其它玩法）
 *   games/brain-gym/index.html       入口壳：只认 ?game=<街机 id>，其余原样交给聚合页
 *   games/brain-gym/arcade/<id>.html 本脚本生成的分片：
 *        三块拼接 ——
 *          A. 脚本开头 → 定位函数结束（公共设施 + 排名在它之前的玩法定义）
 *          B. 「GAMES 只留该游戏一条」+ 空分类 + 空训练计划（30 行，替代 17KB 的清单）
 *          C. 尾部公共系统（外观 / 背景 / 商城 / 道具 / 暂停 / 快捷键，14KB，只依赖 A）
 *             + 菜单 / 商店 / 暂停按钮等界面构建函数（它们会引用 CATS 与全部 GAMES，
 *               在分片里 CATS 已清空，安全）
 *        + 启动段原样保留。
 *   尾部公共系统在 A 之后，所以 A 里任何玩法都能用到它（函数声明是提升的），
 *   而被截掉的只是「排在后面的玩法定义」——那些本分片根本用不到。
 *
 * 分片必须按顺序重跑：上游文件一换，分片就会过期。
 *   node tools/gen-arcade.mjs            # 生成
 *   node tools/gen-arcade.mjs --check    # 只校验分片是否与上游同步（CI / 发版前）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnEnd, blockEnd } from './lib/scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'games/brain-gym/brain-gym.html');
const OUT_DIR = path.join(ROOT, 'games/brain-gym/arcade');
const CHECK = process.argv.includes('--check');

/* 括号扫描放在 tools/lib/scan.mjs：上游是压缩单文件，字符串里混着 {} 与 /，
   必须按字符扫并跳过字符串 / 正则，正则数不准。 */
/* 补丁函数：运行期要用、但定义在 B 段之后的少量小函数，按需整段附加到分片末尾。
   逐片声明而不是一刀切，是为了别让一个用不到的 6KB 函数把所有分片都撑大。 */
const PATCH_FNS = {
  snake: ['function updateTopBar('],
  tiles: ['function shuffle(', 'function updateTopBar('],
  plane: ['function updateTopBar('],
};

/* 每个街机：专属文件里最后一个定位函数的签名（用它切开脚本） */
const CUT = {
  tetris: 'function gTetris(',
  snake: 'function gSnake(',
  mines: 'function gMines(',
  flappy: 'function gFlappy(',
  tiles: 'function gTiles(',
  plane: 'function gPlane(',
  bubble: 'function gBubble(',
  pong: 'function gPong(',
};

if (!fs.existsSync(SRC)) {
  console.error('[arcade] 找不到聚合页：' + path.relative(ROOT, SRC) +
    '\n         需要先把 games/brain-gym/index.html 改名为 brain-gym.html');
  process.exit(1);
}
const html = fs.readFileSync(SRC, 'utf8');
const sOpen = html.indexOf('<script>');
const sEnd = html.lastIndexOf('</script>');
if (sOpen < 0 || sEnd < 0 || sEnd < sOpen) {
  console.error('[arcade] 聚合页结构变化：找不到唯一的 <script> 段');
  process.exit(1);
}
const head = html.slice(0, sOpen + '<script>'.length);
const js = html.slice(sOpen + '<script>'.length, sEnd);
const tail = html.slice(sEnd);

/* 启动段：从「街机直达」注释到脚本结束，原样保留在分片末尾 */
const BOOT_MARK = '/* 街机直达：?game=<id> 合法则直接启动';
const bootAt = js.indexOf(BOOT_MARK);
const GAMES_AT = js.indexOf('var GAMES={');
const ARCADE_AT = js.indexOf('var ARCADE=[');
const TAIL_MARK = '// ================= 外观 / 背景 / 商城 / 道具 系统';
const tailAt = js.indexOf(TAIL_MARK);
/* 菜单区从「每日挑战卡」开始（雷达图 → 每日卡 → 周卡 → 周计划 → 最近玩过 → buildMenu → 快捷键）。
   这几块只依赖 GAMES 的空壳与本地存档，分片里跑得通。 */
let menuAt = js.indexOf('function renderDailyCard()');
if (menuAt < 0) menuAt = js.indexOf('function buildMenu()');
if (menuAt < 0) { console.error('[arcade] 找不到菜单区起点'); process.exit(1); }
if (bootAt < 0 || GAMES_AT < 0 || ARCADE_AT < 0 || tailAt < 0 || menuAt < 0) {
  console.error('[arcade] 聚合页结构变化：找不到启动段 / GAMES / ARCADE 定义');
  process.exit(1);
}
const boot = js.slice(bootAt);

/* GAMES 里每条形如 "\nid:{icon:...}"，据此定位条目边界 */
const entryRe = /\n([A-Za-z0-9]+):\{icon:/g;
const entries = [];
let m;
while ((m = entryRe.exec(js))) entries.push({ id: m[1], at: m.index });

/* GAMES 之外的清单也一起瘦身：分类 / 训练计划里指向被截掉的玩法，菜单会崩。
   注意它们在源码里是两条独立语句：`var CATS=[...];` 与 `TRAIN_PLANS=[...];` */
function slimAux() {
  const out = [];
  for (const [name, head] of [['CATS', 'var CATS=['], ['TRAIN_PLANS', 'TRAIN_PLANS=[']]) {
    const at = js.indexOf(head);
    if (at < 0) { console.error('[arcade] 找不到 ' + name + '，分片菜单可能报错'); continue; }
    const semi = js.indexOf('];', at);
    if (semi < 0) { console.error('[arcade] ' + name + ' 结构无法识别'); continue; }
    out.push((name === 'CATS' ? 'var CATS=[]' : 'TRAIN_PLANS=[]') + ';');
  }
  return out.join('\n') + '\n';
}

function keepOnlyGames(id) {
  /* 在完整脚本里定位：第 id 条 GAMES 条目的起点 → 下一条条目起点或 GAMES 对象结束 */
  const start = js.indexOf('\n' + id + ':{icon:');
  if (start < 0 || start < GAMES_AT) return null;
  const objEnd = js.indexOf('\n};', GAMES_AT);
  if (objEnd < 0) return null;
  const next = entries.find((e) => e.at > start);
  const end = next ? next.at : objEnd;
  return 'var GAMES={' + js.slice(start, end).replace(/\s+$/, '') + '\n};\n';
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const report = [];
let stale = 0;

for (const [id, sig] of Object.entries(CUT)) {
  const cutAt = js.indexOf(sig);
  if (cutAt < 0) {
    console.error('[arcade] 找不到 ' + id + ' 的定位函数：' + sig);
    stale++;
    continue;
  }
  const slim = keepOnlyGames(id);
  if (!slim) {
    console.error('[arcade] GAMES 里没有 ' + id + '，跳过分片');
    stale++;
    continue;
  }
  /* A 段在定位函数结束后立刻收口：先补齐它可能用到的闭括号，再进入 B 段 */
  /* 尾部公共系统收口到「首次进入定级」之前：buildMenu() 及其后的初始化语句
     依赖首页 DOM，分片里没有首页，不能带进来。 */
  const TAIL_END = 'buildMenu();';
  const tailEndAt = js.indexOf(TAIL_END, tailAt);
  const tailBlock = js.slice(tailAt, tailEndAt > 0 ? tailEndAt : bootAt);
  const cutEnd = fnEnd(js, cutAt);
  if (cutEnd < 0) {
    console.error('[arcade] ' + id + ' 的定位函数括括号不匹配，跳过分片');
    stale++;
    continue;
  }
  const before = js.slice(0, cutEnd) +
    '\n/* ---- 分片边界：以上为公共设施与 ' + id + ' 的完整定义，' +
    '排在它之后的玩法已由 tools/gen-arcade.mjs 截除 ---- */\n';
  /* 菜单区 = 「首页 / 每日卡 / 训练计划 / 周计划 / 最近玩过」+ buildMenu 本身 + 快捷键 */
  const uiBlock = js.slice(menuAt, tailAt);
  /* 启动段里补一句：街机成功开局就不再建首页（首页代码不在分片里，建了会炸） */
  const bootPatched = boot.replace('\nelse {', '\nif(!BOOTED){');
  let patch = '';
  for (const sig of (PATCH_FNS[id] || [])) {
    const at = js.indexOf(sig);
    const end = at > 0 ? fnEnd(js, at) : -1;
    if (end < 0) { console.warn('[arcade] ' + id + ' 缺少补丁函数：' + sig); continue; }
    patch += '\n/* 补丁：' + sig.replace('function ', '').replace('(', '') + ' 定义在分片区间之外，按需带上 */\n' + js.slice(at, end) + '\n';
  }
  const shardJs = before + slim + slimAux() + uiBlock + patch + tailBlock + '\n' + bootPatched;
  /* 分片是独立文档：补一个 data: 图标，免掉浏览器自动请求 /favicon.ico 的那条 404 */
  const shardHead = head.includes('rel="icon"')
    ? head
    : head.replace(/<title>/i, '<link rel="icon" href="data:,">\n<title>');
  const out = shardHead + shardJs + tail;
  const file = path.join(OUT_DIR, id + '.html');

  /* 分片不允许依赖被截掉的部分：启动段只引用 ARCADE_SET / GAMES / openGame */
  if (!/function openGame\(/.test(shardJs)) {
    console.error('[arcade] ' + id + ' 分片缺少 openGame，生成结果不可用');
    stale++;
    continue;
  }

  if (CHECK) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (cur !== out) { console.error('[arcade] 分片已过期：' + id + '.html'); stale++; }
  } else {
    fs.writeFileSync(file, out, 'utf8');
  }
  report.push({ id, kb: Math.round(Buffer.byteLength(out) / 1024) });
}

if (!CHECK) {
  console.log('[arcade] 聚合页 ' + Math.round(Buffer.byteLength(html) / 1024) + 'KB → 分片 ' +
    report.length + ' 个：');
  for (const r of report) {
    console.log('           ' + r.id.padEnd(9) + r.kb + 'KB' +
      (r.id === 'snake' ? '   （含 snake 专属逻辑，体积最大是正常的）' : ''));
  }
} else {
  console.log(stale ? '[arcade] check：有 ' + stale + ' 个分片与上游不一致' : '[arcade] check：分片与上游一致');
  process.exit(stale ? 1 : 0);
}
if (stale) process.exit(1);
