@echo off
title ورشة التصميم والقص - Watchdog
cd /d "%~dp0"
powershell -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "%~dp0watchdog.ps1" -NoWindow
