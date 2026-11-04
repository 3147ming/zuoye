#!/usr/bin/env node
/* ============================================================
 * tools/check-contrib.mjs —— 自建内容校验
 * ------------------------------------------------------------
 * 用法：node tools/check-contrib.mjs
 * 退出码 0 = 全部合格；1 = 有问题（会逐条列出来）
 *
 * 查五件事：
 *   1) 注册字段合法（id 格式与唯一、name/desc 长度、cat 白名单、color 格式）；
 *   2) src 指向的文件存在，且在 contrib/ 下（不许 http、不许跳出去）；
 *   3) 入口 HTML 里没有外链（CDN / 外域脚本 / 外域字体）；
 *   4) 入口 HTML 没用 type="module"（file:// 下会被 CORS 挡掉）；
 *   5) 单条目的目录体积（> 40MB 提示）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, 'contrib', 'manifest.js');
const LIMIT_MB = 40;

const ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CATS = new Set(['games', 'tools']);

let bad = 0;
const fail = (msg) => { bad++; console.log('  ✗ ' + msg); };
const ok = (msg) => console.log('  ✓ ' + msg);

if (!fs.existsSync(MANIFEST)) {
  console.log('没有 contrib/manifest.js，跳过（这是允许的）');
  process.exit(0);
}

/* ---------- 1. 把注册调用抓出来 ---------- */
const src = fs.readFileSync(MANIFEST, 'utf8');
const captured = [];
const fakeWindow = {
  WorldHub: {
    register(entry) {
      const arr = Array.isArray(entry) ? entry : [entry];
      for (const e of arr) captured.push(e);
    }
  }
};

try {
  new Function('window', src)(fakeWindow);
} catch (err) {
  console.log('manifest.js 执行报错：' + err.message);
  process.exit(1);
}

console.log('=== 自建内容校验 ===\n');
console.log('注册条目：' + captured.length + '\n');

if (!captured.length) {
  ok('没有注册任何条目');
  console.log('\n=== 结果：0 项，全部通过 ===');
  process.exit(0);
}

/* ---------- 2. 逐条检查 ---------- */
const seen = new Set();

captured.forEach((e, i) => {
  const tag = '#' + (i + 1) + ' ' + (e && e.name ? e.name : '(无名)');
  console.log(tag);

  if (!e || typeof e !== 'object') { fail('不是一个对象'); return; }

  if (typeof e.id !== 'string' || !ID_RE.test(e.id)) {
    fail('id 不合法（小写字母/数字/连字符，2~32 位）：' + JSON.stringify(e.id));
  } else if (seen.has(e.id)) {
    fail('id 重复：' + e.id);
  } else {
    seen.add(e.id);
    ok('id = ' + e.id);
  }

  if (typeof e.name !== 'string' || !e.name.trim()) fail('name 缺失');
  else if ([...e.name].length > 24) fail('name 超过 24 字：' + e.name);
  else ok('name = ' + e.name);

  if (!CATS.has(e.cat)) fail('cat 只能是 games / tools，收到 ' + JSON.stringify(e.cat));
  else ok('cat = ' + e.cat);

  if (e.color != null && !COLOR_RE.test(String(e.color))) fail('color 要 #rrggbb：' + e.color);
  if (e.desc != null && [...String(e.desc)].length > 28) fail('desc 超过 28 字');

  /* src */
  let srcPath = null;
  if (typeof e.src !== 'string' || !e.src.trim()) {
    fail('src 缺失');
  } else if (/^(https?:)?\/\//i.test(e.src) || /^data:/i.test(e.src)) {
    fail('src 不能是 URL：' + e.src);
  } else if (/\.\.(\/|\\)/.test(e.src)) {
    fail('src 不能跳出仓库：' + e.src);
  } else {
    srcPath = path.join(ROOT, e.src);
    const rel = path.relative(path.join(ROOT, 'contrib'), srcPath);
    if (rel.startsWith('..')) {
      fail('src 必须放在 contrib/ 下：' + e.src);
      srcPath = null;
    } else if (!fs.existsSync(srcPath)) {
      fail('src 指向的文件不存在：' + e.src);
      srcPath = null;
    } else {
      ok('src = ' + e.src);
    }
  }

  /* 入口 HTML 检查 */
  if (srcPath) {
    const html = fs.readFileSync(srcPath, 'utf8');
    const ext = [];

    const linkRe = /(src|href)\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = linkRe.exec(html))) {
      const v = m[2].trim();
      if (/^(https?:)?\/\//i.test(v)) ext.push(v);
    }

    if (ext.length) {
      fail('引用了外链（断网就废）：' + ext.slice(0, 3).join(' | '));
    } else {
      ok('无外链');
    }

    if (/<script[^>]+type\s*=\s*["']module["']/i.test(html)) {
      fail('用了 type="module"，file:// 下会被 CORS 挡掉');
    } else {
      ok('传统 script');
    }

    if (/<script[^>]+sandbox/i.test(html)) fail('sandbox 属性不该出现在入口页');
  }

  /* 体积 */
  if (srcPath) {
    const dir = path.dirname(srcPath);
    let bytes = 0;
    const walk = (d) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p);
        else bytes += fs.statSync(p).size;
      }
    };
    try { walk(dir); } catch (err) { /* 忽略 */ }
    const mb = bytes / 1024 / 1024;
    if (mb > LIMIT_MB) console.log('  ! 目录 ' + mb.toFixed(1) + 'MB，超过 ' + LIMIT_MB + 'MB，建议压一压');
    else ok('目录 ' + mb.toFixed(1) + 'MB');
  }

  console.log('');
});

console.log(bad
  ? '=== 结果：' + bad + ' 处不合格 ==='
  : '=== 结果：' + captured.length + ' 条，全部通过 ===');

process.exit(bad ? 1 : 0);
