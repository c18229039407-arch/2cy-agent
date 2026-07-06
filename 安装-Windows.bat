@echo off
chcp 65001 >nul
title 2CY Agent 安装
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [提示] 未检测到 Node.js（需要 18 或更高版本）。
  echo 已为你打开官网，请下载安装 LTS 版本后，重新双击本文件。
  start https://nodejs.org/
  pause
  exit /b 1
)

set "DEST=%LOCALAPPDATA%\2CY-Agent"
echo 正在安装 2CY Agent 到 %DEST% ...
robocopy "%~dp0." "%DEST%" /E /XD data node_modules .git /NFL /NDL /NJH /NJS >nul

echo 正在创建桌面与开始菜单快捷方式 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; foreach($p in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))){ $s=$ws.CreateShortcut((Join-Path $p '2CY Agent.lnk')); $s.TargetPath=Join-Path $env:LOCALAPPDATA '2CY-Agent\启动-Windows.bat'; $s.WorkingDirectory=Join-Path $env:LOCALAPPDATA '2CY-Agent'; $s.IconLocation=(Join-Path $env:LOCALAPPDATA '2CY-Agent\assets\logo.ico'); $s.Description='本地优先的二次元 Agent'; $s.Save() }"

echo.
echo 安装完成！桌面和开始菜单里已经有「2CY Agent」，双击即可启动。
echo （卸载：删除 %DEST% 文件夹和快捷方式即可，数据都在该文件夹的 data 目录里。）
pause
