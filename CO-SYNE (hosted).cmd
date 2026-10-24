@echo off
rem Opens all three CO-SYNE apps connected to the hosted pilot server (no local server).
cd /d "%~dp0"
set COSYNE_SERVER=https://iobeacons.com/cosyne
node scripts\launch.mjs %*
