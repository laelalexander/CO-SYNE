@echo off
rem Opens the CO-SYNE Officer Terminal full screen, as the patrol terminal's shell. Alt+F4 to exit.
cd /d "%~dp0"

if not exist node_modules\jsqr (
  echo Installing CO-SYNE dependencies...
  call npm install --omit=dev || (echo npm install failed. Install Node.js 20+ from https://nodejs.org and try again. & pause & exit /b 1)
)
node scripts\launch.mjs officer --kiosk
