import './style.css';
import { Game, loadAssets } from './game/game';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui');
  if (!canvas || !uiRoot) {
    throw new Error('页面缺少 #game 或 #ui 节点');
  }

  const assets = await loadAssets();
  const game = new Game(canvas, assets);

  const titleBg = document.querySelector<HTMLElement>('.title-bg');
  if (titleBg) {
    titleBg.style.backgroundImage = "url('./assets/art/title.jpg')";
  }

  // 方便调试与外部扩展
  (window as unknown as { __game?: Game }).__game = game;
}

boot().catch((err) => {
  console.error('[烬影·墨刃] 启动失败', err);
  const root = document.getElementById('ui');
  if (root) {
    root.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        flex-direction:column;gap:12px;color:#e8e2d4;font-family:system-ui,sans-serif;text-align:center;padding:24px;">
        <h1 style="font-size:22px;letter-spacing:4px;">游戏未能启动</h1>
        <p style="opacity:.7;font-size:13px;max-width:520px;line-height:1.7;">
          请确认通过本地服务器访问（如 <code>npm run dev</code>），而不是直接双击打开 HTML 文件。<br/>
          错误信息：${String(err)}
        </p>
      </div>`;
  }
});
