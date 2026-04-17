@echo off
chcp 65001 >nul
:: ============================================================
::  Price Mirror — Установка заданий планировщика Windows
::  Запускать от имени Администратора
:: ============================================================

set SCRIPT_DIR=%~dp0
set PYTHON=C:\Users\User\AppData\Local\Programs\Python\Python310\python.exe

:: Проверяем, что Python найден
if not exist "%PYTHON%" (
    echo [ОШИБКА] Python не найден по пути: %PYTHON%
    echo Укажите правильный путь в переменной PYTHON в этом файле.
    pause
    exit /b 1
)

echo.
echo  Price Mirror — Установка заданий планировщика Windows
echo ============================================================
echo  Python: %PYTHON%
echo  Папка:  %SCRIPT_DIR%
echo ============================================================
echo.

:: ---- 1. Утреннее сканирование — будни 09:00 ----
set TASK_MORNING=PriceMirror_Scan_Morning
echo [1/3] Регистрация задачи "%TASK_MORNING%" (Пн-Пт 09:00)...
schtasks /delete /tn "%TASK_MORNING%" /f >nul 2>&1
schtasks /create ^
  /tn "%TASK_MORNING%" ^
  /tr "\"%PYTHON%\" \"%SCRIPT_DIR%run_scan_once.py\"" ^
  /sc WEEKLY ^
  /d MON,TUE,WED,THU,FRI ^
  /st 09:00 ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f
if %ERRORLEVEL% == 0 (
    echo    [OK] Задача зарегистрирована.
) else (
    echo    [ОШИБКА] Не удалось зарегистрировать задачу.
)

:: ---- 2. Вечернее сканирование — будни 16:00 ----
set TASK_EVENING=PriceMirror_Scan_Evening
echo [2/3] Регистрация задачи "%TASK_EVENING%" (Пн-Пт 16:00)...
schtasks /delete /tn "%TASK_EVENING%" /f >nul 2>&1
schtasks /create ^
  /tn "%TASK_EVENING%" ^
  /tr "\"%PYTHON%\" \"%SCRIPT_DIR%run_scan_once.py\"" ^
  /sc WEEKLY ^
  /d MON,TUE,WED,THU,FRI ^
  /st 16:00 ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f
if %ERRORLEVEL% == 0 (
    echo    [OK] Задача зарегистрирована.
) else (
    echo    [ОШИБКА] Не удалось зарегистрировать задачу.
)

:: ---- 3. Фоновый воркер — мониторинг очереди (запуск при входе) ----
set TASK_WORKER=PriceMirror_Worker
echo [3/3] Регистрация задачи "%TASK_WORKER%" (очередь, запуск при входе в систему)...
schtasks /delete /tn "%TASK_WORKER%" /f >nul 2>&1
schtasks /create ^
  /tn "%TASK_WORKER%" ^
  /tr "\"%PYTHON%\" \"%SCRIPT_DIR%run_worker.py\"" ^
  /sc ONLOGON ^
  /delay 0001:00 ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f
if %ERRORLEVEL% == 0 (
    echo    [OK] Задача зарегистрирована.
) else (
    echo    [ОШИБКА] Не удалось зарегистрировать задачу.
)

echo.
echo ============================================================
echo  Итог: зарегистрированы следующие задачи:
echo.
echo   PriceMirror_Scan_Morning  — Пн-Пт в 09:00 (полный скан)
echo   PriceMirror_Scan_Evening  — Пн-Пт в 16:00 (полный скан)
echo   PriceMirror_Worker        — при входе в систему (очередь)
echo ============================================================
echo.

choice /m "Запустить утреннее сканирование прямо сейчас (тест)?"
if %ERRORLEVEL% == 1 (
    echo Запускаем тестовый скан...
    schtasks /run /tn "%TASK_MORNING%"
    echo Задача запущена в фоне. Проверьте scraper_log.txt для результатов.
)

pause
