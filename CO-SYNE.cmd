@echo off
rem Double-click to open all three CO-SYNE apps (driver, officer, dispatch) on this computer.
cd /d "%~dp0"

if not exist node_modules\jsqr (
  echo Installing CO-SYNE dependencies...
  call npm install --omit=dev || (echo npm install failed. Install Node.js 20+ from https://nodejs.org and try again. & pause & exit /b 1)
)
node scripts\launch.mjs %*
