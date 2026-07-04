#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 没有检测到 Node.js（本项目需要 Node.js 18 或更高版本）。"
  echo "请先到 https://nodejs.org/ 下载安装 LTS 版本，装完后重新双击本文件。"
  open "https://nodejs.org/"
  read -n 1 -s -r -p "按任意键退出..."
  exit 1
fi

echo "正在启动 2CY Agent，稍后会自动打开浏览器 ..."
( sleep 2; open "http://127.0.0.1:2333" ) &
node server.mjs
