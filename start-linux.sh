#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 没有检测到 Node.js（本项目需要 Node.js 18 或更高版本）。"
  echo "请先安装 Node.js（https://nodejs.org/），然后重新运行本脚本。"
  exit 1
fi

echo "正在启动 2CY Agent ..."
( sleep 2; xdg-open "http://127.0.0.1:2333" >/dev/null 2>&1 ) &
node server.mjs
