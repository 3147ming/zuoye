/* 批量补齐远端缺失文件（用 git tree API 递归比对，按需分批建 blob）
   用法：node push-missing.mjs [--dry] */
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.GH_TOKEN || '';
const OWNER = '3147ming', REPO = 'zuoye', BRANCH = 'master';
const ROOT = '/workspace/WorldHub';
const API = 'https://api.github.com';
const DRY = process.argv.includes('--dry');

/* 不推的大文件/构建产物 */
const SKIP_TOP = new Set(['cloudflared', 'package-lock.json']);
const SKIP_DIR = new Set(['.git', 'node_modules', 'deploy', 'dist', '内容加厚核验', '.wrangler', 'ws-bundle']);

async function gh(p, opt = {}) {
  const r = await fetch(API + p, {
    ...opt,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'worldhub-deploy',
      ...(opt.headers || {})
    }
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 300); }
  if (!r.ok) throw new Error(`${opt.method || 'GET'} ${p} -> ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

const tree = await gh(`/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`);
const remote = new Set(tree.tree.filter((x) => x.type === 'blob').map((x) => x.path));

const local = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs);
    else {
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      if (SKIP_TOP.has(rel)) continue;
      local.push(rel);
    }
  }
})(ROOT);

const missing = local.filter((f) => !remote.has(f)).sort();
console.log(`本地 ${local.length} / 远端 ${remote.size} / 缺失 ${missing.length}`);
if (!missing.length) { console.log('没有缺失'); process.exit(0); }

const buckets = new Map();
for (const f of missing) {
  const top = f.split('/')[0];
  if (!buckets.has(top)) buckets.set(top, []);
  buckets.get(top).push(f);
}
for (const [k, v] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k}: ${v.length}`);
}

if (DRY) { console.log('\n--dry，未推送'); process.exit(0); }

/* 分批建 blob，再合并成一棵树、一个提交 */
const BATCH = 40;
const allBlobs = [];
for (let i = 0; i < missing.length; i += BATCH) {
  const slice = missing.slice(i, i + BATCH);
  const treeBlobs = [];
  for (const rel of slice) {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    const b = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' })
    });
    treeBlobs.push({ path: rel, mode: '100644', type: 'blob', sha: b.sha });
  }
  allBlobs.push(...treeBlobs);
  console.log(`  blob 批次 ${Math.floor(i / BATCH) + 1}: ${slice.length} 个 (${slice[0]} …)`);
}

const ref = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const head = ref.object.sha;
const newTree = await gh(`/repos/${OWNER}/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ base_tree: head, tree: allBlobs })
});
const commit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message: `补齐 ${missing.length} 个缺失文件（脑力训练场/双重 N-Back/街机厅 + 核心脚本 + 服务端 + 工具链）`,
    tree: newTree.sha,
    parents: [head]
  })
});
await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha })
});
console.log('\npushed:', commit.sha.slice(0, 8), `(${allBlobs.length} 个文件)`);
