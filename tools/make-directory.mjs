#!/usr/bin/env node
/* tools/make-directory.mjs —— 从 js/world.js 的 ITEMS 生成静态 SEO 目录页
 * 用法：node tools/make-directory.mjs
 * 产出：directory.html（真实 DOM 文本 + JSON-LD ItemList，搜索引擎/读屏可读）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worldSrc = fs.readFileSync(path.join(ROOT, 'js/world.js'), 'utf8');

const start = worldSrc.indexOf('var ITEMS = [');
const endMark = '\n  ];';
const end = worldSrc.indexOf(endMark, start);
if (start < 0 || end < 0) { console.error('ITEMS 块没找到'); process.exit(1); }
const closeIdx = end + endMark.indexOf(']') + 1;   /* 含收尾的 ] */
const arrText = worldSrc.slice(start + 'var ITEMS = '.length, closeIdx);
const ITEMS = new Function('return ' + arrText)();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const groups = [];
for (const it of ITEMS) {
  const g = it.cat === 'tools' ? '工具' : (it.group || '游戏').replace(/^..\s*/, '');
  let bucket = groups.find((x) => x.name === g);
  if (!bucket) { bucket = { name: g, items: [] }; groups.push(bucket); }
  bucket.items.push(it);
}

const ORIGIN = 'https://zuoye-e0c.pages.dev';
const abs = (src) => /^https?:/.test(src) ? src : ORIGIN + '/' + src.replace(/^\//, '');

let listHtml = '';
let ldItems = '';
let n = 0;
for (const g of groups) {
  listHtml += '      <section class="grp">\n        <h2>' + esc(g.name) + '<span>' + g.items.length + ' 个</span></h2>\n        <ul>\n';
  for (const it of g.items) {
    n++;
    const url = abs(it.src);
    listHtml += '          <li>\n' +
      '            <a class="card" href="' + esc(url) + '"' + (it.cross ? ' target="_blank" rel="noopener noreferrer"' : '') + '>\n' +
      '              <b>' + esc(it.name) + '</b>\n' +
      '              <i>' + esc(it.desc || '') + '</i>\n' +
      '              <u>' + esc(it.cross ? '联网打开' : '本地可玩') + '</u>\n' +
      '            </a>\n          </li>\n';
    ldItems += '    {\n' +
      '      "@type": "ListItem",\n' +
      '      "position": ' + n + ',\n' +
      '      "name": ' + JSON.stringify(it.name) + ',\n' +
      '      "description": ' + JSON.stringify(it.desc || '') + ',\n' +
      '      "url": ' + JSON.stringify(url) + '\n' +
      '    },\n';
  }
  listHtml += '        </ul>\n      </section>\n';
}
ldItems = ldItems.replace(/,\n$/, '\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>区块目录 · 世界大厅</title>
<meta name="description" content="世界大厅全部 ${ITEMS.length} 个区块的目录：工具、脑力街机、开源小游戏与大厅自研玩法，一键直达。">
<meta name="theme-color" content="#0b0817">
<link rel="canonical" href="${ORIGIN}/directory">
<meta property="og:title" content="区块目录 · 世界大厅">
<meta property="og:description" content="世界大厅全部 ${ITEMS.length} 个区块的目录，一键直达。">
<meta property="og:type" content="website">
<meta property="og:url" content="${ORIGIN}/directory">
<meta property="og:image" content="${ORIGIN}/assets/og.png">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "世界大厅区块目录",
  "numberOfItems": ${ITEMS.length},
  "itemListElement": [
${ldItems}  ]
}
</script>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 16px 64px;
    background: radial-gradient(1200px 700px at 50% -100px, #1c1430, #0b0817 70%);
    color: #f3e9da;
    font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    line-height: 1.6;
  }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: 0.08em; color: #ffe3bd; }
  .sub { margin: 0 0 28px; color: rgba(243, 233, 218, 0.6); font-size: 14px; }
  .sub a { color: #f0a76e; }
  h2 {
    font-size: 16px; letter-spacing: 0.12em; color: #f0a76e;
    margin: 28px 0 10px; font-weight: 600;
  }
  h2 span { margin-left: 10px; font-size: 12px; color: rgba(243, 233, 218, 0.45); letter-spacing: 0; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: 1fr; }
  @media (min-width: 640px) { ul { grid-template-columns: 1fr 1fr; } }
  .card {
    display: block; padding: 14px 16px; text-decoration: none;
    border: 1px solid rgba(255, 220, 180, 0.14); border-radius: 12px;
    background: rgba(255, 255, 255, 0.035); color: #f3e9da;
  }
  .card:hover { background: rgba(240, 167, 110, 0.12); border-color: rgba(240, 167, 110, 0.45); }
  .card b { display: block; font-size: 16px; color: #ffe3bd; }
  .card i { display: block; font-style: normal; font-size: 13px; color: rgba(243, 233, 218, 0.6); margin: 2px 0 6px; }
  .card u { text-decoration: none; font-size: 11px; color: rgba(240, 167, 110, 0.8); letter-spacing: 0.08em; }
  .foot { margin-top: 40px; font-size: 12px; color: rgba(243, 233, 218, 0.4); }
  .foot a { color: #f0a76e; }
</style>
</head>
<body>
  <main class="wrap">
    <h1>世界大厅 · 区块目录</h1>
    <p class="sub">共 ${ITEMS.length} 个区块 · 一键直达 · <a href="${ORIGIN}/">回到探索大厅</a></p>
${listHtml}    <p class="foot">世界大厅 —— 2D 横版探索式游戏合集入口。本页为静态目录，供搜索引擎与读屏软件读取；进入大厅后可走路探索、按 E 互动。</p>
  </main>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'directory.html'), html, 'utf8');
console.log('directory.html 已生成：' + ITEMS.length + ' 个区块 / ' + groups.length + ' 个分组');
