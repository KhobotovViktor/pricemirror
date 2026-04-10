@echo off
:: Регистрирует Price Mirror Worker в Windows Task Scheduler
:: Запускать от имени Администратора

set TASK_NAME=PriceMirrorWorker
set SCRIPT_DIR=%~dp0
set PYTHON=python
set SCRIPT=%SCRIPT_DIR%run_worker.py

echo Регистрация задачи "%TASK_NAME%" в планировщике Windows...

schtasks /delete /tn "%TASK_NAME%" /f 2>nul

schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "\"%PYTHON%\" \"%SCRIPT%\"" ^
  /sc ONLOGON ^
  /delay 0001:00 ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f

if %ERRORLEVEL% == 0 (
    echo.
    echo [OK] Задача зарегистрирована. Воркер будет запускаться автоматически при входе в систему.
    echo.
    echo Запустить сейчас?
    schtasks /run /tn "%TASK_NAME%"
) else (
    echo.
    echo [ОШИБКА] Не удалось зарегистрировать задачу.
    echo Запустите файл от имени Администратора.
)
pause
