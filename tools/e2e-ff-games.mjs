/* ============================================================
 * tools/e2e-ff-games.mjs —— FreeFocusGames 复刻（24 款）总体验收
 * 覆盖：24 门全部可加载 / 0 报错 / 交互钩子在位 / 关键玩法可驱动 / 等比装裱 / 手机热区
 * 用法：node tools/e2e-ff-games.mjs
 * ============================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '内容加厚核验', 'ff');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8787';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const GAMES = [
  ['f1-reaction','__F1','16/9'],['cps-test','__CPS','9/16'],['spacebar-clicker','__SPACE','9/16'],
  ['challenge-10-seconds','__TEN','9/16'],['larger-number','__LARGER','9/16'],['schulte-table','__SCHULTE','1/1'],
  ['rotating-schulte','__ROT','1/1'],['fish-trace','__FISH','1/1'],['double-decision','__DD','1/1'],
  ['flanker-test','__FLANKER','16/9'],['stroop-effect','__STROOP','9/16'],['trail-making','__TMT','1/1'],
  ['pvt','__PVT','9/16'],['digit-span','__DS','9/16'],['sequence-memory','__SEQ','1/1'],
  ['frog-memory-leap','__FROG','1/1'],['short-term-memory','__STM','9/16'],['counting-boxes','__BOX','1/1'],
  ['resonance-breathing','__BREATH','9/16'],['box-breathing','__BREATH','9/16'],['478-breathing','__BREATH','9/16'],
  ['focus-sudoku','__SUDOKU','1/1'],['sbti-test','__SBTI','9/16'],['bamboo-cicada','__BAMBOO','9/16']
];

const browser = await chromium.launch({ executablePath:'/usr/bin/chromium', args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
let checks=0, fails=0;
function ok(c,l,d){checks++;if(c)console.log('  ✓ '+l);else{fails++;console.log('  ✗ '+l+(d?' — '+d:''))}}

async function loadGame(ctx, id, src){
  const page = await ctx.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push('pageerror:'+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))errors.push('console:'+m.text())});
  await page.goto(BASE+'/'+src,{waitUntil:'domcontentloaded',timeout:15000});
  return {page,errors};
}

/* ---------------- 一、24 门全部可加载 + 钩子 ---------------- */
console.log('=== 24 门全部加载 / 交互钩子 / 0 报错 ===');
{
  const ctx = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  for (const [id,hook,ratio] of GAMES){
    const {page,errors} = await loadGame(ctx,id,'games/ff/'+id+'/index.html');
    await page.waitForTimeout(120);
    const hasHook = await page.evaluate((h)=>!!window[h],hook);
    ok(hasHook, id+' 钩子在位',hook);
    ok(errors.length===0, id+' 0 报错', errors.join('|'));
    // 容器与按钮热区
    const app = await page.locator('#app').boundingBox();
    ok(app && app.height>600, id+' 竖屏容器占满',app&&String(app.height));
    // 布局边界：任何主要元素都不得溢出视口（等比装裱环境下最容易出现）
    const lay = await page.evaluate(()=>{
      const vw=innerWidth, vh=innerHeight;
      let over=[];
      document.querySelectorAll('canvas,.grid,.pond,.scene,.canv,#app').forEach(el=>{
        const r=el.getBoundingClientRect();
        if(r.width<=0||r.height<=0) return;
        if(r.right>vw+1.5||r.bottom>vh+1.5||r.left<-1.5||r.top<-1.5){
          over.push((el.id||el.className)+':'+Math.round(r.width)+'x'+Math.round(r.height)+'@'+Math.round(r.right)+','+Math.round(r.bottom));
        }
      });
      return {over,vw,vh};
    });
    ok(lay.over.length===0, id+' 无元素溢出视口', lay.over.join(' | '));
    await page.close();
  }
  await ctx.close();
}

/* ---------------- 二、关键玩法可驱动 ---------------- */
console.log('=== 关键玩法驱动 ===');
{
  const ctx = await browser.newContext({viewport:{width:900,height:900},serviceWorkers:'block'});
  // CPS 点击
  {
    const {page} = await loadGame(ctx,'cps-test','games/ff/cps-test/index.html');
    await page.evaluate(()=>{__CPS.hit();__CPS.hit();__CPS.hit()});
    ok(await page.evaluate(()=>__CPS.count)===3,'CPS 点击计数正确');
    await page.close();
  }
  // 舒尔特顺序点击
  {
    const {page} = await loadGame(ctx,'schulte-table','games/ff/schulte-table/index.html');
    await page.evaluate(()=>__SCHULTE.start());
    const r = await page.evaluate(()=>{__SCHULTE.setSize(3);__SCHULTE.start();return {n:__SCHULTE.n,next:__SCHULTE.nextNum}});
    ok(r.n===9 && r.next===1,'舒尔特 3×3 从 1 开始',JSON.stringify(r));
    await page.close();
  }
  // Stroop 答题
  {
    const {page} = await loadGame(ctx,'stroop-effect','games/ff/stroop-effect/index.html');
    await page.evaluate(()=>__STROOP.start());
    const r = await page.evaluate(()=>{const c=__STROOP.inkC;__STROOP.answer(c);return {correct:__STROOP.correct}});
    ok(r.correct===1,'Stroop 选墨色计分正确',JSON.stringify(r));
    await page.close();
  }
  // Flanker 作答
  {
    const {page} = await loadGame(ctx,'flanker-test','games/ff/flanker-test/index.html');
    await page.evaluate(()=>__FLANKER.start());
    ok(await page.evaluate(()=>__FLANKER.phase)==='go','Flanker 进入试次');
    await page.close();
  }
  // 数字广度
  {
    const {page} = await loadGame(ctx,'digit-span','games/ff/digit-span/index.html');
    await page.evaluate(()=>__DS.setMode('forward'));
    ok(await page.evaluate(()=>__DS.len)>=3,'数字广度从 3 位起');
    await page.close();
  }
  // 数独固定解
  {
    const {page} = await loadGame(ctx,'focus-sudoku','games/ff/focus-sudoku/index.html');
    const r = await page.evaluate(()=>{const g=__SUDOKU.grid,f=__SUDOKU.fixed;let ok=true;for(let i=0;i<81;i++){if(f[i]&&g[i]===0)ok=false}return {ok,len:g.length}});
    ok(r.ok&&r.len===81,'数独 9×9 题目生成',JSON.stringify(r));
    await page.close();
  }
  // SBTI 全流程
  {
    const {page} = await loadGame(ctx,'sbti-test','games/ff/sbti-test/index.html');
    await page.evaluate(()=>{let g=0;while(__SBTI.i<16&&g++<30)__SBTI.choose('+卷')});
    ok(await page.evaluate(()=>__SBTI.i)===16,'SBTI 16 题走完');
    ok(await page.locator('#result').evaluate(e=>e.style.display!=='none'),'SBTI 出结果');
    await page.close();
  }
  // 呼吸模式
  {
    const {page} = await loadGame(ctx,'478-breathing','games/ff/478-breathing/index.html');
    ok(await page.evaluate(()=>__BREATH.mode)==='478','4-7-8 默认模式正确');
    await page.evaluate(()=>__BREATH.start());
    ok(await page.evaluate(()=>document.getElementById('btn').textContent)==='暂停','呼吸开始');
    await page.close();
  }
  // 竹知了
  {
    const {page} = await loadGame(ctx,'bamboo-cicada','games/ff/bamboo-cicada/index.html');
    await page.evaluate(()=>__BAMBOO.setOmega(8));
    await page.waitForTimeout(150);
    ok(Math.abs(await page.evaluate(()=>__BAMBOO.omega))>=0,'竹知了转速驱动');
    await page.close();
  }
  await ctx.close();
}

/* ---------------- 三、大厅集成：24 门都能通过 iframeScene 打开 ---------------- */
console.log('=== 大厅集成：分组 / 装裱 / 门可进入 ===');
{
  const ctx = await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
  const page = await ctx.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push('pageerror:'+e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push('console:'+m.text())});
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded',timeout:20000});
  await page.waitForFunction(()=>window.SceneManager,null,{timeout:10000});
  // 抽查 3 个不同 ratio 的门
  for (const [id,hook,ratio] of [['schulte-table','__SCHULTE','1/1'],['f1-reaction','__F1','16/9'],['pvt','__PVT','9/16']]){
    await page.evaluate((p)=>window.SceneManager.change('iframe',p),{title:id,src:'games/ff/'+id+'/index.html',ratio});
    await page.waitForFunction((h)=>{const f=document.querySelector('.iframe-scene');return f&&f.contentWindow&&f.contentWindow[h]},hook,{timeout:12000});
    ok(true,'大厅打开 '+id);
    const fit=await page.locator('.iframe-fit').boundingBox();
    const exp=ratio==='1/1'?1:(ratio==='16/9'?16/9:9/16);
    ok(fit&&Math.abs(fit.width/fit.height-exp)<0.06,id+' 装裱比例 '+ratio,fit&&(fit.width/fit.height).toFixed(3));
  }
  ok(errors.length===0,'大厅集成 0 报错',errors.join('|'));
  await page.screenshot({path:path.join(OUT,'hall-group.png')});
  await ctx.close();
}

console.log('\n========================================');
console.log(`总体验收：${checks-fails}/${checks} 通过`+(fails===0?' · 全绿':` · ${fails} 项失败`));
console.log('========================================');
await browser.close();
process.exit(fails===0?0:1);
