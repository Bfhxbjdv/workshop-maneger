@echo off
title Workshop Manager
cd /d "%~dp0"
echo Starting Workshop Manager...
powershell -NoProfile -ExecutionPolicy Bypass -File "launcher.ps1"
pause
