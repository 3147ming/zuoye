#!/usr/bin/env bash
# 双击运行（或终端执行 ./开服.sh）
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "没装 Node.js，先装一下：https://nodejs.org/"
  exit 1
fi
node tools/tunnel.mjs "$@"
