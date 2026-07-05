@echo off
chcp 65001 >nul
title 2CY Agent
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [错误] 没有检测到 Node.js（本项目需要 Node.js 18 或更高版本）。
  echo 请先到 https://nodejs.org/ 下载安装 LTS 版本，装完后重新双击本文件。
  echo.
  start https://nodejs.org/
  pause
  exit /b 1
)

echo 正在启动 2CY Agent，浏览器将自动打开 ...
node server.mjs
pause
