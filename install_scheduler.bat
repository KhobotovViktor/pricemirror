@echo off
setlocal enabledelayedexpansion

:: ---- Auto-elevate to Administrator via UAC ----
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Requesting Administrator rights...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set PYTHON=C:\Users\User\AppData\Local\Programs\Python\Python310\python.exe
set SCRIPT_DIR=%~dp0

echo.
echo  Price Mirror - Windows Task Scheduler Setup
echo  ============================================
echo  Python: %PYTHON%
echo  Dir:    %SCRIPT_DIR%
echo.

if not exist "%PYTHON%" (
    echo [ERROR] Python not found: %PYTHON%
    echo Please update the PYTHON variable in this file.
    pause
    exit /b 1
)

set SCAN_SCRIPT=%SCRIPT_DIR%run_scan_once.py
set WORKER_SCRIPT=%SCRIPT_DIR%run_worker.py

echo [1/3] Registering PriceMirror_Scan_Morning  (Mon-Fri 09:00)...
schtasks /delete /tn "PriceMirror_Scan_Morning" /f >nul 2>&1
schtasks /create /tn "PriceMirror_Scan_Morning" /tr "\"%PYTHON%\" \"%SCAN_SCRIPT%\"" /sc WEEKLY /d MON,TUE,WED,THU,FRI /st 09:00 /ru "%USERNAME%" /rl HIGHEST /f
if %ERRORLEVEL%==0 (echo    OK) else (echo    FAILED)

echo [2/3] Registering PriceMirror_Scan_Evening  (Mon-Fri 16:00)...
schtasks /delete /tn "PriceMirror_Scan_Evening" /f >nul 2>&1
schtasks /create /tn "PriceMirror_Scan_Evening" /tr "\"%PYTHON%\" \"%SCAN_SCRIPT%\"" /sc WEEKLY /d MON,TUE,WED,THU,FRI /st 16:00 /ru "%USERNAME%" /rl HIGHEST /f
if %ERRORLEVEL%==0 (echo    OK) else (echo    FAILED)

echo [3/3] Registering PriceMirror_Worker        (on logon, queue monitor)...
schtasks /delete /tn "PriceMirror_Worker" /f >nul 2>&1
schtasks /create /tn "PriceMirror_Worker" /tr "\"%PYTHON%\" \"%WORKER_SCRIPT%\"" /sc ONLOGON /delay 0001:00 /ru "%USERNAME%" /rl HIGHEST /f
if %ERRORLEVEL%==0 (echo    OK) else (echo    FAILED)

echo.
echo  Done. Tasks registered:
echo    PriceMirror_Scan_Morning  - Mon-Fri 09:00
echo    PriceMirror_Scan_Evening  - Mon-Fri 16:00
echo    PriceMirror_Worker        - on logon
echo.
echo  Run test scan now? (Y/N)
set /p CONFIRM="> "
if /i "%CONFIRM%"=="Y" (
    echo Running test scan...
    schtasks /run /tn "PriceMirror_Scan_Morning"
    echo Task started. Check scraper_log.txt for results.
)

endlocal
pause
