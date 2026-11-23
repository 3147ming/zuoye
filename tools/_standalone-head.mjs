#!/usr/bin/env node
/* ============================================================
 * 开服.mjs —— 单文件版「一键开服」（零依赖，放哪都能跑）
 * ------------------------------------------------------------
 *   node 开服.mjs              起房间服务 + 公网隧道，打印可分享地址
 *   node 开服.mjs --local      只起服务（同一个 WiFi 玩，不要隧道）
 *   node 开服.mjs --no-ssh     跳过系统 ssh，直接用 cloudflared
 *   node 开服.mjs --port 9000  换端口
 *
 * 关于下载：以前一上来就要下 53 MB 的 cloudflared，网不好会卡在 0%。
 *   现在先看系统里有没有自带的 ssh（Win10+ 默认有），有就用 localhost.run
 *   的反向隧道，完全不下载；不行才回退到 cloudflared。
 *
 * 为什么要有这个文件：
 *   以前要 `node tools/tunnel.mjs`，前提是本地有完整的 tools/ 目录。
 *   实际很多人拿到的是散落的文件，本地没有 tools，于是永远卡在
 *   `Error: Cannot find module ...\tools\tunnel.mjs`，看着像环境坏了。
 *   这里把「房间服务 + 隧道」压成一个 .mjs：不需要 npm install，
 *   不需要目录结构，放到任意文件夹里 `node 开服.mjs` 就能开。
 *
 * 房间服务不是另写一份：下面内嵌的就是 server/ 下的真实实现
 * （protocol / room-core / 7 个玩法），行为与 `node server/index.js` 一致。
 * 由 tools/make-standalone-server.mjs 生成，勿手改。
 *
 * 退出：Ctrl+C，子进程会被一起收掉。
 * ============================================================ */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs, { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argList = process.argv.slice(2);
const LOCAL_ONLY = argList.includes('--local');
/* --no-ssh：跳过「系统自带 ssh」那条免下载隧道，直接用 cloudflared */
const NO_CFD = argList.includes('--no-ssh');
const portArg = argList.indexOf('--port');
const PORT = portArg > -1 ? Number(argList[portArg + 1]) : (Number(process.env.PORT) || 8787);
const HOST = '0.0.0.0';

const isWin = process.platform === 'win32';
const C = isWin
  ? { g: '', y: '', c: '', d: '', r: '', b: '' }
  : { g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', d: '\x1b[2m', r: '\x1b[31m', b: '\x1b[0m' };
const BOX = isWin
  ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' }
  : { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' };

function line(s = '') { process.stdout.write(s + '\n'); }
function box(lines2, color = C.g) {
  const w = Math.max(...lines2.map((l) => [...l].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0)));
  const pad = (l) => l + ' '.repeat(Math.max(0, w - [...l].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0)));
  line(color + '  ' + BOX.tl + BOX.h.repeat(w + 2) + BOX.tr + C.b);
  for (const l of lines2) line(color + '  ' + BOX.v + ' ' + pad(l) + ' ' + BOX.v + C.b);
  line(color + '  ' + BOX.bl + BOX.h.repeat(w + 2) + BOX.br + C.b);
}

/* ---- 下面这段来自 server/（由 tools/make-standalone-server.mjs 生成，勿手改） ---- */
const SERVER_CHUNKS = [
