#!/usr/bin/env node
/* ============================================================
 * tools/check-links.mjs —— 预置网址自检（第八批⑦）
 * ------------------------------------------------------------
 * 从 tools/links/index.html 里解析 PRESETS 并逐条自检：
 *   1) 格式：http(s) 绝对地址、无空白
 *   2) 伪协议：拒绝 javascript:/data:/file: 等
 *   3) 黑名单：与 functions/api/links.js 的 BLACK 24 词一致
 *   4) 去重：按 hostname(去 www) + pathname(去尾斜杠) 归一化
 *   5) 注入安全：name/desc/cat 不得含 < > 引号 反斜杠 控制字符
 *   6) 锁定项：ming-games 必须存在且 locked=true
 *   7) 条数：≥ 150
 * 用法：
 *   node tools/check-links.mjs                 仅自检
 *   node tools/check-links.mjs --json          机器可读输出
 * ============================================================ */
import fs from 'node:fs';

const FILE = 'tools/links/index.html';
const BLACK = ['赌博', '博彩', '赌场', '彩票', '时时彩', '六合彩', '色情', '成人', '淫秽',
  '黄色', '嫖娼', '诈骗', '刷单', '外挂', '私服', '恶意软件', '钓鱼', '毒品', '枪支',
  '传销', '高利贷', '裸聊', 'http://', 'https://', 'www.'];

const src = fs.readFileSync(FILE, 'utf8');

function parsePresets(text) {
  const a = text.indexOf('[', text.indexOf('var PRESETS ='));
  if (a < 0) throw new Error('找不到 var PRESETS');
  let d = 0, inStr = false, esc = false, end = -1;
  for (let i = a; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '[') d++;
    else if (c === ']') { d--; if (!d) { end = i; break; } }
  }
  return JSON.parse(text.slice(a, end + 1));
}

function norm(u) {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '');
  } catch { return String(u).toLowerCase(); }
}

const items = parsePresets(src);
const errors = [];
const seen = new Map();

for (let i = 0; i < items.length; i++) {
  const it = items[i];
  const tag = `[${i}] ${it.name || '(无名)'}`;
  // 格式
  if (!/^https?:\/\/[^\s]+$/i.test(it.url || '')) errors.push(`${tag} 格式非法: ${it.url}`);
  // 伪协议
  if (/^(javascript|data|file|blob|vbscript):/i.test(it.url || '')) errors.push(`${tag} 伪协议: ${it.url}`);
  // 黑名单（只查文本字段，url 单独判格式；与 API 一致）
  const low = ((it.name || '') + (it.desc || '') + (it.cat || '') + (it.author || '')).toLowerCase();
  const hit = BLACK.find(w => low.includes(w));
  if (hit) errors.push(`${tag} 命中黑名单词「${hit}」`);
  // 注入安全
  for (const k of ['name', 'desc', 'cat', 'author']) {
    if (typeof it[k] === 'string' && /[<>"'\\\u0000-\u001f\u007f]/.test(it[k])) {
      errors.push(`${tag} 字段 ${k} 含危险字符`);
    }
  }
  // 去重
  const key = norm(it.url);
  if (seen.has(key)) errors.push(`${tag} 与 [${seen.get(key)}] 重复: ${key}`);
  else seen.set(key, i);
}

// 锁定项
const ming = items.find(x => /ming-games/.test(x.url || ''));
if (!ming || ming.locked !== true) errors.push('ming-games 预置必须存在且 locked=true');

// 条数
if (items.length < 150) errors.push(`条数不足: ${items.length} < 150`);

// 分类统计
const byCat = {};
items.forEach(x => { byCat[x.cat] = (byCat[x.cat] || 0) + 1; });

const result = {
  total: items.length,
  unique: seen.size,
  categories: byCat,
  locked: items.filter(x => x.locked).map(x => x.name + ' -> ' + x.url),
  errors,
  pass: errors.length === 0
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`预置网址自检：共 ${result.total} 条，去重后 ${result.unique} 条，${Object.keys(byCat).length} 个分类`);
  console.log('分类条数：');
  Object.keys(byCat).sort().forEach(c => console.log(`  ${c}: ${byCat[c]}`));
  console.log('锁定项：' + result.locked.join(', '));
  if (errors.length) {
    console.log(`\n✗ 自检失败 ${errors.length} 项：`);
    errors.forEach(e => console.log('  - ' + e));
    process.exitCode = 1;
  } else {
    console.log('\n✓ 自检全过（格式/伪协议/黑名单/去重/注入/锁定/条数）');
  }
}
