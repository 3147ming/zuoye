/* ============================================================
 * functions/api/links.js —— 网址推荐 · 共享存储
 * ------------------------------------------------------------
 * Cloudflare Pages Function（路由 /api/links）
 * · 主案：KV 共享（namespace 变量名 LINKS，需在 Pages 后台绑定一次）
 * · KV 未绑定时返回 503，前端自动降级 localStorage（本地模式）
 * · GET 返回列表；POST 校验后追加；DELETE 按 id 删除（开放，课程演示，README 注明风险）
 * ============================================================ */

const PRESET = [
  {
    "id": "preset-chat-openai-com",
    "name": "ChatGPT",
    "url": "https://chat.openai.com",
    "desc": "OpenAI 旗舰大模型，综合能力强，支持插件与多模态",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-claude-ai",
    "name": "Claude",
    "url": "https://claude.ai",
    "desc": "Anthropic 出品，长文本处理与逻辑推理出色，支持大文件上传",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-gemini-google-com",
    "name": "Gemini",
    "url": "https://gemini.google.com",
    "desc": "Google 多模态大模型，深度集成搜索与代码能力",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-chat-deepseek-com",
    "name": "DeepSeek",
    "url": "https://chat.deepseek.com",
    "desc": "国产开源大模型，推理与代码能力突出，网页端免费",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-kimi-moonshot-cn",
    "name": "Kimi",
    "url": "https://kimi.moonshot.cn",
    "desc": "国产长文本大模型，支持百万字文档解析，免费额度充足",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-qwen-aliyun-com",
    "name": "Qwen 通义千问",
    "url": "https://qwen.aliyun.com",
    "desc": "阿里通义千问官方网页版，多模态与工具调用能力强",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-poe-com",
    "name": "Poe",
    "url": "https://poe.com",
    "desc": "一站式聚合平台，同时接入 GPT、Claude、Gemini 等多款模型",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-perplexity-ai",
    "name": "Perplexity",
    "url": "https://www.perplexity.ai",
    "desc": "AI 搜索引擎，每个回答附带来源链接，调研必备",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-notebooklm-google-com",
    "name": "NotebookLM",
    "url": "https://notebooklm.google.com",
    "desc": "上传文档/PDF 生成专属知识库，支持音频播客式讲解",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-genspark-ai",
    "name": "Genspark",
    "url": "https://www.genspark.ai",
    "desc": "AI 研究助手，自动整理成完整研究报告",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-elicit-org",
    "name": "Elicit",
    "url": "https://elicit.org",
    "desc": "学术文献 AI 检索，直接从论文中提取答案与证据",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-mathgpt-com",
    "name": "MathGPT",
    "url": "https://mathgpt.com",
    "desc": "专注数学解题与推导，支持公式可视化步骤",
    "cat": "🤖 AI 对话与搜索",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-midjourney-com",
    "name": "Midjourney",
    "url": "https://www.midjourney.com",
    "desc": "顶级 AI 绘画，画质与艺术感领先",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-ideogram-ai",
    "name": "Ideogram",
    "url": "https://ideogram.ai",
    "desc": "AI 绘图，文字生成精准度高",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-klingai-com",
    "name": "可灵 AI",
    "url": "https://klingai.com",
    "desc": "快手出品，文生视频/图生视频效果出色",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-elevenlabs-io",
    "name": "ElevenLabs",
    "url": "https://elevenlabs.io",
    "desc": "AI 语音生成，多语言音色拟真度极高",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-runwayml-com",
    "name": "Runway",
    "url": "https://runwayml.com",
    "desc": "专业级 AI 视频创作工具，支持 Gen-3 视频生成",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-suno-com",
    "name": "Suno",
    "url": "https://suno.com",
    "desc": "AI 生成完整歌曲，作词作曲演唱一步到位",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-udio-com",
    "name": "Udio",
    "url": "https://udio.com",
    "desc": "AI 音乐生成，风格多样，音质媲美专业制作",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-gamma-app",
    "name": "Gamma",
    "url": "https://gamma.app",
    "desc": "输入大纲自动生成精美 PPT/网页/文档，排版审美在线",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-cursor-com",
    "name": "Cursor",
    "url": "https://cursor.com",
    "desc": "AI 原生代码编辑器，深度集成大模型，重构/写代码效率极高",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-github-com-copilot",
    "name": "GitHub Copilot",
    "url": "https://github.com/copilot",
    "desc": "VS Code 等 IDE 插件，实时代码补全与解释",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-v0-dev",
    "name": "v0",
    "url": "https://v0.dev",
    "desc": "Vercel 出品，输入描述直接生成 React/Next.js 前端组件",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-codeium-com",
    "name": "Codeium",
    "url": "https://codeium.com",
    "desc": "免费 AI 编程助手，支持多语言多 IDE",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-codeium-com-windsurf",
    "name": "Windsurf",
    "url": "https://codeium.com/windsurf",
    "desc": "AI 原生编辑器，支持全项目上下文理解，Cursor 竞品",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-cognition-ai",
    "name": "Devin",
    "url": "https://cognition.ai",
    "desc": "首个 AI 软件工程师，可独立完成完整开发任务",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-pieces-app",
    "name": "Pieces",
    "url": "https://pieces.app",
    "desc": "代码片段智能管理，自动分类标注，跨 IDE 同步",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-db-gpt-cn",
    "name": "DB-GPT",
    "url": "https://db-gpt.cn",
    "desc": "私有化数据库对话 AI，支持自然语言查数与分析",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-civitai-com",
    "name": "Civitai",
    "url": "https://civitai.com",
    "desc": "AI 绘画模型社区，海量 LoRA/Checkpoint 模型分享",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-pika-art",
    "name": "Pika",
    "url": "https://pika.art",
    "desc": "AI 视频生成，支持图生视频、视频扩帧与风格化",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-magnific-ai",
    "name": "Magnific",
    "url": "https://magnific.ai",
    "desc": "AI 图像超分辨率放大，细节还原度极高",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-cleanup-pictures",
    "name": "Cleanup.pictures",
    "url": "https://cleanup.pictures",
    "desc": "一键去除图片中多余物体，操作极简",
    "cat": "🎨 AI 创作与编程",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-codesandbox-io",
    "name": "CodeSandbox",
    "url": "https://codesandbox.io",
    "desc": "前端在线 IDE，开箱即用 React/Vue/Angular 项目",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-stackblitz-com",
    "name": "StackBlitz",
    "url": "https://stackblitz.com",
    "desc": "浏览器内运行 Node.js 环境，速度快",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-replit-com",
    "name": "Replit",
    "url": "https://replit.com",
    "desc": "全栈在线编程平台，支持多语言，内置 AI 助手",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-regex101-com",
    "name": "Regex101",
    "url": "https://regex101.com",
    "desc": "正则表达式在线调试，实时匹配+逐段语法解释",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-explainshell-com",
    "name": "ExplainShell",
    "url": "https://explainshell.com",
    "desc": "粘贴 Linux 命令，逐参数拆解解释含义",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-json-cn",
    "name": "JSON.cn",
    "url": "https://www.json.cn",
    "desc": "JSON 格式化/校验/压缩，国内访问快",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-carbon-now-sh",
    "name": "Carbon",
    "url": "https://carbon.now.sh",
    "desc": "代码一键生成精美截图，适合分享与文档",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-jsfiddle-net",
    "name": "JSFiddle",
    "url": "https://jsfiddle.net",
    "desc": "前端代码在线调试，HTML/CSS/JS 实时预览",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-db-fiddle-com",
    "name": "DB Fiddle",
    "url": "https://db-fiddle.com",
    "desc": "SQL 在线运行，支持 MySQL/PostgreSQL/SQLite 多版本",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-gchq-github-io-CyberChef",
    "name": "CyberChef",
    "url": "https://gchq.github.io/CyberChef",
    "desc": "瑞士军刀级数据处理工具，编码/加密/转换全覆盖",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-urlencoder-io",
    "name": "URL Encode/Decode",
    "url": "https://www.urlencoder.io",
    "desc": "URL 编解码及各类编码转换工具集合",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-postman-com",
    "name": "Postman",
    "url": "https://www.postman.com",
    "desc": "API 开发测试行业标准工具",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-reqable-com",
    "name": "Reqable",
    "url": "https://reqable.com",
    "desc": "国产 API 调试与抓包工具，轻量高效",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-mocky-io",
    "name": "Mocky",
    "url": "https://mocky.io",
    "desc": "快速生成自定义响应的 Mock API，无需注册",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-play-tailwindcss-com",
    "name": "Tailwind Play",
    "url": "https://play.tailwindcss.com",
    "desc": "Tailwind CSS 在线实时预览调试",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-caniuse-com",
    "name": "Can I Use",
    "url": "https://caniuse.com",
    "desc": "浏览器特性兼容性查询，前端开发必备",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-bundlephobia-com",
    "name": "Bundlephobia",
    "url": "https://bundlephobia.com",
    "desc": "查询 npm 包体积与依赖，优化打包大小",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-framer-com",
    "name": "Framer",
    "url": "https://www.framer.com",
    "desc": "无代码建站与交互设计，导出可直接上线",
    "cat": "💻 开发与调试工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-figma-com",
    "name": "Figma",
    "url": "https://www.figma.com",
    "desc": "云端 UI/UX 设计工具，团队协作出色",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-penpot-app",
    "name": "Penpot",
    "url": "https://penpot.app",
    "desc": "开源设计与原型工具，Figma 平替",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-photopea-com",
    "name": "Photopea",
    "url": "https://www.photopea.com",
    "desc": "浏览器版 PS，支持 PSD 格式，功能强大",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-canva-com",
    "name": "Canva",
    "url": "https://www.canva.com",
    "desc": "在线设计平台，海量模板覆盖海报/PPT/短视频等",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-unsplash-com",
    "name": "Unsplash",
    "url": "https://unsplash.com",
    "desc": "高质量免费摄影图库，CC0 协议可商用",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-pexels-com",
    "name": "Pexels",
    "url": "https://www.pexels.com",
    "desc": "免费图片+视频素材库，质量稳定检索方便",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-pixabay-com",
    "name": "Pixabay",
    "url": "https://pixabay.com",
    "desc": "超 400 万免费图片/插画/矢量图/视频",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-polyhaven-com",
    "name": "Poly Haven",
    "url": "https://polyhaven.com",
    "desc": "专业级 HDRI、PBR 材质、3D 模型，全部 CC0 免费",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-freepik-com",
    "name": "Freepik",
    "url": "https://www.freepik.com",
    "desc": "矢量图/PSD/图标海量素材库，免费可商用",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-thenounproject-com",
    "name": "The Noun Project",
    "url": "https://thenounproject.com",
    "desc": "全球最大图标符号库，风格统一",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-mixkit-co",
    "name": "Mixkit",
    "url": "https://mixkit.co",
    "desc": "免费可商用视频素材/音效/模板，质量很高",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-freesound-org",
    "name": "Freesound",
    "url": "https://freesound.org",
    "desc": "协作式音效素材库，海量免费声音采样",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-textures-com",
    "name": "Textures",
    "url": "https://www.textures.com",
    "desc": "高清材质纹理图库，3D 建模与设计常用",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-remove-bg",
    "name": "Remove.bg",
    "url": "https://www.remove.bg",
    "desc": "一键抠图去除背景，免费可用",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-squoosh-app",
    "name": "Squoosh",
    "url": "https://squoosh.app",
    "desc": "Google 出品图片压缩工具，支持多种格式对比",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-vectorizer-ai",
    "name": "Vectorizer.AI",
    "url": "https://vectorizer.ai",
    "desc": "位图一键转矢量图，AI 自动描摹",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-brandmark-io",
    "name": "Brandmark",
    "url": "https://brandmark.io",
    "desc": "AI 一键生成 Logo 与品牌视觉系统",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-fonts-google-com",
    "name": "Google Fonts",
    "url": "https://fonts.google.com",
    "desc": "全球最大免费开源字库，网页直接引用",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-color-adobe-com",
    "name": "Adobe Color",
    "url": "https://color.adobe.com",
    "desc": "专业色轮工具，生成和谐配色方案",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-coolors-co",
    "name": "Coolors",
    "url": "https://coolors.co",
    "desc": "快速生成配色板，空格键随机探索",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-fontsquirrel-com",
    "name": "Font Squirrel",
    "url": "https://www.fontsquirrel.com",
    "desc": "免费商用字体集合，授权清晰",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-myfonts-com-WhatTheFont",
    "name": "WhatTheFont",
    "url": "https://www.myfonts.com/WhatTheFont",
    "desc": "上传图片识别字体名称",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-colorhunt-co",
    "name": "Color Hunt",
    "url": "https://colorhunt.co",
    "desc": "人工精选配色方案，每日更新",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-webgradients-com",
    "name": "Web Gradients",
    "url": "https://webgradients.com",
    "desc": "180 种精美渐变背景，可直接复制 CSS",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-iconfont-cn",
    "name": "Iconfont",
    "url": "https://www.iconfont.cn",
    "desc": "阿里矢量图标库，海量免费图标支持多格式导出",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-undraw-co",
    "name": "unDraw",
    "url": "https://undraw.co",
    "desc": "免费可商用插画库，支持一键改色匹配品牌色",
    "cat": "🎨 设计与素材",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-scholar-google-com",
    "name": "Google Scholar",
    "url": "https://scholar.google.com",
    "desc": "学术文献检索，引用追踪必备",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-zotero-org",
    "name": "Zotero",
    "url": "https://www.zotero.org",
    "desc": "开源文献管理工具，插件生态丰富",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-overleaf-com",
    "name": "Overleaf",
    "url": "https://www.overleaf.com",
    "desc": "在线 LaTeX 编辑器，协作方便，模板丰富",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-semanticscholar-org",
    "name": "Semantic Scholar",
    "url": "https://www.semanticscholar.org",
    "desc": "学术搜索引擎，AI 提炼核心观点",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-connectedpapers-com",
    "name": "Connected Papers",
    "url": "https://www.connectedpapers.com",
    "desc": "文献可视化关系图谱，快速摸清研究脉络",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-paperswithcode-com",
    "name": "PaperWithCode",
    "url": "https://paperswithcode.com",
    "desc": "论文对应开源代码合集，追踪 SOTA 方法",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-mathpix-com",
    "name": "Mathpix",
    "url": "https://mathpix.com",
    "desc": "截图识别数学公式，直接转 LaTeX",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-consensus-app",
    "name": "Consensus",
    "url": "https://consensus.app",
    "desc": "AI 学术问答，基于论文给出证据化结论",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-scite-ai",
    "name": "Scite",
    "url": "https://scite.ai",
    "desc": "查看论文被引用的立场（支持/反驳/提及），辨别研究可靠性",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-sci-hub-se",
    "name": "Sci-Hub",
    "url": "https://sci-hub.se",
    "desc": "学术论文全文获取（域名经常变动，需自行查找最新地址）",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-libgen-is",
    "name": "LibGen",
    "url": "https://libgen.is",
    "desc": "电子书与文献资源库，覆盖学科广",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-z-lib-org",
    "name": "Z-Library",
    "url": "https://z-lib.org",
    "desc": "全球最大电子图书馆（需通过官方渠道访问）",
    "cat": "📚 学术与研究",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-public-tableau-com",
    "name": "Tableau Public",
    "url": "https://public.tableau.com",
    "desc": "免费数据可视化工具，制作交互式图表",
    "cat": "📊 数据与可视化",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-rawgraphs-io",
    "name": "RawGraphs",
    "url": "https://www.rawgraphs.io",
    "desc": "开源数据可视化工具，支持多种少见图表类型",
    "cat": "📊 数据与可视化",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-csvjson-com",
    "name": "CSVJSON",
    "url": "https://csvjson.com",
    "desc": "CSV/JSON/XML 等数据格式互转",
    "cat": "📊 数据与可视化",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-wolframalpha-com",
    "name": "Wolfram Alpha",
    "url": "https://www.wolframalpha.com",
    "desc": "计算知识引擎，数学/科学/统计计算神器",
    "cat": "📊 数据与可视化",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-tradingview-com",
    "name": "TradingView",
    "url": "https://www.tradingview.com",
    "desc": "专业金融图表与技术分析平台",
    "cat": "📊 数据与可视化",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-audacityteam-org",
    "name": "Audacity",
    "url": "https://www.audacityteam.org",
    "desc": "开源免费音频编辑软件，功能强大",
    "cat": "🎵 音视频处理",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-kapwing-com",
    "name": "Kapwing",
    "url": "https://www.kapwing.com",
    "desc": "在线视频剪辑工具，无需下载客户端",
    "cat": "🎵 音视频处理",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-clideo-com",
    "name": "Clideo",
    "url": "https://clideo.com",
    "desc": "在线视频工具箱，压缩/裁剪/合并/字幕全覆盖",
    "cat": "🎵 音视频处理",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-audiomass-co",
    "name": "AudioMass",
    "url": "https://audiomass.co",
    "desc": "浏览器端免费音频编辑器",
    "cat": "🎵 音视频处理",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-lalal-ai",
    "name": "Lalal.ai",
    "url": "https://www.lalal.ai",
    "desc": "AI 人声伴奏分离，提取干声效果出色",
    "cat": "🎵 音视频处理",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-tinypng-com",
    "name": "TinyPNG",
    "url": "https://tinypng.com",
    "desc": "智能 PNG/JPG 图片压缩，体积小画质损失少",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-smallpdf-com",
    "name": "Smallpdf",
    "url": "https://smallpdf.com",
    "desc": "PDF 全能工具箱，转换/压缩/合并/签名",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-cloudconvert-com",
    "name": "CloudConvert",
    "url": "https://cloudconvert.com",
    "desc": "200+ 种格式在线转换，文档音视频全覆盖",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-excalidraw-com",
    "name": "Excalidraw",
    "url": "https://excalidraw.com",
    "desc": "手绘风格在线白板，画架构图流程图很方便",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-tldraw-com",
    "name": "Tldraw",
    "url": "https://www.tldraw.com",
    "desc": "极简在线白板，协作流畅，导出格式多",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-obsidian-md",
    "name": "Obsidian",
    "url": "https://obsidian.md",
    "desc": "本地优先的双链笔记，插件生态极其丰富",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-bitwarden-com",
    "name": "Bitwarden",
    "url": "https://bitwarden.com",
    "desc": "开源密码管理器，跨平台同步，可自部署",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-tiddlywiki-com",
    "name": "TiddlyWiki",
    "url": "https://tiddlywiki.com",
    "desc": "单文件维基笔记，高度可定制，纯本地运行",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-typst-app",
    "name": "Typst",
    "url": "https://typst.app",
    "desc": "类 LaTeX 排版语言，语法更简单，编译速度极快",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-zapier-com",
    "name": "Zapier",
    "url": "https://zapier.com",
    "desc": "无代码自动化平台，连接数千款应用",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-n8n-io",
    "name": "n8n",
    "url": "https://n8n.io",
    "desc": "开源工作流自动化，可自部署，功能强大",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-notion-so",
    "name": "Notion",
    "url": "https://www.notion.so",
    "desc": "全能笔记与协作工具，模板生态丰富",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-yuque-com",
    "name": "语雀",
    "url": "https://www.yuque.com",
    "desc": "阿里文档/笔记工具，国内访问快",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-docs-qq-com",
    "name": "腾讯文档",
    "url": "https://docs.qq.com",
    "desc": "在线协作表格文档，国内免费",
    "cat": "🛠️ 效率与工具",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-ming-games-pages-dev",
    "name": "我的游戏合集",
    "url": "https://ming-games.pages.dev/",
    "desc": "个人网页游戏合集（预置锁定）",
    "cat": "🎮 游戏与娱乐",
    "preset": true,
    "locked": true
  },
  {
    "id": "preset-itch-io",
    "name": "itch.io",
    "url": "https://itch.io",
    "desc": "独立游戏发行平台，大量免费/付费小游戏",
    "cat": "🎮 游戏与娱乐",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-4399-com",
    "name": "4399小游戏",
    "url": "https://www.4399.com",
    "desc": "国内经典小游戏站，海量网页游戏",
    "cat": "🎮 游戏与娱乐",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-bilibili-com",
    "name": "哔哩哔哩",
    "url": "https://www.bilibili.com",
    "desc": "国内视频平台，学习+娱乐内容丰富",
    "cat": "📺 视频与音乐",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-music-163-com",
    "name": "网易云音乐",
    "url": "https://music.163.com",
    "desc": "国内音乐平台，推荐算法精准",
    "cat": "📺 视频与音乐",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-y-qq-com",
    "name": "QQ音乐",
    "url": "https://y.qq.com",
    "desc": "腾讯音乐平台，曲库全",
    "cat": "📺 视频与音乐",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-huggingface-co-spaces",
    "name": "Hugging Face Spaces",
    "url": "https://huggingface.co/spaces",
    "desc": "全球最新 AI 小工具 Demo 集合，免费试用",
    "cat": "🔍 导航与聚合",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-www-toolify-ai",
    "name": "Toolify",
    "url": "https://www.toolify.ai",
    "desc": "AI 工具分类导航，持续更新新工具",
    "cat": "🔍 导航与聚合",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-github-com",
    "name": "GitHub",
    "url": "https://github.com",
    "desc": "全球最大代码托管平台，开源项目聚集地",
    "cat": "🔍 导航与聚合",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-gitee-com",
    "name": "Gitee",
    "url": "https://gitee.com",
    "desc": "国内代码托管平台，访问快",
    "cat": "🔍 导航与聚合",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-huggingface-co",
    "name": "Hugging Face",
    "url": "https://huggingface.co",
    "desc": "全球最大 AI 模型社区，模型/数据集/Demo 一站式",
    "cat": "🔍 导航与聚合",
    "preset": true,
    "locked": false
  },
  {
    "id": "preset-mvnrepository-com",
    "name": "Maven Repository",
    "url": "https://mvnrepository.com",
    "desc": "Java 依赖查询神器",
    "cat": "🔍 导航与聚合",
    "preset": true,
    "locked": false
  }
];

const BLACKLIST = ['赌博', '博彩', '赌场', '彩票', '时时彩', '六合彩', '色情', '成人', '淫秽', '黄色', '嫖娼',
  '诈骗', '刷单', '外挂', '代练', '私服', '恶意软件', '钓鱼', '毒品', '枪支', '传销', '高利贷', '裸聊'];

const KEY = 'items';
const MAX_ITEMS = 500;

const clone = (o) => JSON.parse(JSON.stringify(o));
const hasKV = (env) => !!(env && env.LINKS);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

// KV 存储格式：{ items: 用户自建条目[], deleted: 已删除预置的 id/url 集合 }
async function readRaw(env) {
  const raw = await env.LINKS.get(KEY);
  if (!raw) return { items: [], deleted: {} };
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) {
      // 旧版格式兼容：非预置当作用户条目，预置忽略（由 PRESET 兜底），不标记删除
      return { items: p.filter((x) => !x.preset), deleted: {} };
    }
    if (p && typeof p === 'object') {
      return { items: Array.isArray(p.items) ? p.items : [], deleted: p.deleted || {} };
    }
  } catch (e) {}
  return { items: [], deleted: {} };
}

async function writeRaw(env, obj) {
  await env.LINKS.put(KEY, JSON.stringify(obj));
}

// 最终列表 = 预置（去掉已删除） + 用户自建，按 id/url 去重
async function readList(env) {
  const { items: userItems, deleted } = await readRaw(env);
  const seen = new Set();
  const out = [];
  for (const it of PRESET) {
    if (deleted[it.id] || deleted[it.url]) continue;
    if (seen.has(it.id) || seen.has(it.url)) continue;
    seen.add(it.id); seen.add(it.url);
    out.push(it);
  }
  for (const it of userItems) {
    if (seen.has(it.id) || seen.has(it.url)) continue;
    if (it.id) seen.add(it.id);
    if (it.url) seen.add(it.url);
    out.push(it);
  }
  return out;
}

function validate(name, url, list) {
  if (!name || typeof name !== 'string' || !name.trim()) return '请填写名称';
  if (name.trim().length > 30) return '名称最多 30 字';
  if (!url || typeof url !== 'string' || !url.trim()) return '请填写网址';
  let u;
  try { u = new URL(url); } catch (e) { return '网址格式不正确'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '只支持 http / https 链接';
  for (const w of BLACKLIST) {
    if (name.includes(w) || url.includes(w)) return '内容包含违禁词：' + w;
  }
  for (const x of list) {
    if (x.url === url) return '该网址已在列表中';
  }
  return null;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function onRequestGet(context) {
  if (!hasKV(context.env)) return json({ items: [clone(PRESET)], error: 'KV 未绑定（LINKS），本地模式' }, 200);
  const list = await readList(context.env);
  return json({ items: list });
}

export async function onRequestPost(context) {
  if (!hasKV(context.env)) return json({ error: 'KV 未绑定（LINKS）' }, 503);
  let body = {};
  try { body = await context.request.json(); } catch (e) { /* ignore */ }
  const name = String((body && body.name) || '').trim();
  const url = String((body && body.url) || '').trim();
  const cat = String((body && body.cat) || '').trim();
  const merged = await readList(context.env);
  const err = validate(name, url, merged);
  if (err) return json({ error: err }, 422);
  if (merged.length >= MAX_ITEMS) return json({ error: '列表已满' }, 422);
  const obj = await readRaw(context.env);
  obj.items = obj.items || [];
  obj.items.push({ id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name, url, cat: cat || '未分类', ts: Date.now() });
  await writeRaw(context.env, obj);
  return json({ ok: true, items: await readList(context.env) });
}

export async function onRequestDelete(context) {
  if (!hasKV(context.env)) return json({ error: 'KV 未绑定（LINKS）' }, 503);
  const id = new URL(context.request.url).searchParams.get('id');
  if (!id) return json({ error: '缺少 id' }, 400);
  const list = await readList(context.env);
  const target = list.find((x) => x.id === id);
  if (!target) return json({ error: '条目不存在' }, 404);
  if (target.locked) return json({ error: '锁定的预置条目不可删' }, 403);
  const obj = await readRaw(context.env);
  if (target.preset) {
    obj.deleted = obj.deleted || {};
    obj.deleted[id] = true;
    if (target.url) obj.deleted[target.url] = true;
  } else {
    obj.items = (obj.items || []).filter((x) => x.id !== id);
  }
  await writeRaw(context.env, obj);
  return json({ ok: true, items: await readList(context.env) });
}
