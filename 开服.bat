@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found.
  echo   Install it first: https://nodejs.org/  ^(LTS version^)
  echo.
  pause
  exit /b 1
)

node tools\tunnel.mjs %*

echo.
pause
