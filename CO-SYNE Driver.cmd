@echo off
rem Opens the CO-SYNE Driver app (phone simulator).
cd /d "%~dp0"

if not exist node_modules\jsqr (
  echo Installing CO-SYNE dependencies...
  call npm install --omit=dev || (echo npm install failed. Install Node.js 20+ from https://nodejs.org and try again. & pause & exit /b 1)
)
node scripts\launch.mjs driver
