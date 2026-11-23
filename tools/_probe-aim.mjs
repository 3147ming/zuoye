import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');
const BASE = 'http://127.0.0.1:8787';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const A = await browser.newPage();
await A.goto(BASE + '/games/party/', { waitUntil: 'domcontentloaded' });
const info = await A.evaluate(async () => {
  /* 直接起一个本地房间，不连服务端 */
  const K = window.PARTYKIT || window.PartyKit;
  return { hasKit: !!window.PARTY_KIT_STATE, keys: Object.keys(window).filter((k) => /PARTY|WH_/i.test(k)) };
});
console.log(JSON.stringify(info));
await browser.close();
