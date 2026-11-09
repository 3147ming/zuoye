import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const out = process.argv[2] ?? path.join(root, '..', 'ink-blade-standalone.html');

let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

// 1. 去掉 modulepreload
html = html.replace(/<link[^>]+rel="modulepreload"[^>]*>\s*/g, '');

// 2. 内联样式
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, href) => {
  const file = path.join(dist, href.replace(/^\.?\//, ''));
  return `<style>\n${fs.readFileSync(file, 'utf8')}\n</style>`;
});

// 3. 图片转 data URI
const assets = {};
for (const kind of ['art', 'tiles']) {
  const dir = path.join(dist, 'assets', kind);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    const ext = path.extname(name).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    assets[`${kind}/${path.basename(name, ext)}`] = `data:${mime};base64,${fs
      .readFileSync(path.join(dir, name))
      .toString('base64')}`;
  }
}
const assetsScript = `<script>window.__INK_ASSETS__=${JSON.stringify(assets)}</script>`;

// 4. 内联入口脚本
const scriptRe = /<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/;
const match = html.match(scriptRe);
if (!match) throw new Error('dist/index.html 中未找到入口 module 脚本');
const js = fs.readFileSync(path.join(dist, match[1].replace(/^\.?\//, '')), 'utf8');
const inline = `<script type="module">\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
html = html.replace(scriptRe, () => `${assetsScript}\n${inline}`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(2);
console.log(`单文件版已生成: ${out} (${mb} MB)`);
