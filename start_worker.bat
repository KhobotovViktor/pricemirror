@echo off
title Price Mirror — Local Worker
cd /d "%~dp0"
echo ============================================
echo   Price Mirror — Local Playwright Worker
echo ============================================
echo.
echo Воркер запущен. Не закрывайте это окно.
echo Для остановки нажмите Ctrl+C
echo.
python run_worker.py
pause
