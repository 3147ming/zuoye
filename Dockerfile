# syntax=docker/dockerfile:1
# ============================================================
# Dockerfile —— 联机房间服务（Render / Koyeb / Fly.io / 任意容器平台）
# ------------------------------------------------------------
# 为什么需要它：这些平台的「静态站点」不跑进程，联机服务必须以 Web 服务形态常驻。
# 镜像很小（约 60 MB），只装 server/ 与 ws，不含前端页面。
#
# 构建：docker build -t worldhub-ws .
# 运行：docker run -p 8787:8787 -e PORT=8787 worldhub-ws
# ============================================================
FROM node:20-alpine

WORKDIR /app

# 只装运行期依赖（ws 缺失时服务有内置兜底，但装上更稳）
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server ./server

# 平台会注入 PORT；默认 8787
ENV PORT=8787 HOST=0.0.0.0 NODE_ENV=production

EXPOSE 8787

# 健康检查：/healthz 返回 {ok:true,...}
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
