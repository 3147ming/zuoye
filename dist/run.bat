@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 启动电路实验模拟器 http://127.0.0.1:5360/
start "" http://127.0.0.1:5360/
node server.mjs
pause
