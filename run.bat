@echo off
title BKK Pulse-Alert Runner
cls

echo ===================================================
echo   Starting BKK Pulse-Alert Real API Prototype...
echo ===================================================
echo.

:: ตรวจสอบว่ามีโปรเซสไหนรันอยู่ที่พอร์ต 3000 ไหม ถ้ามีให้สลัดทิ้ง (Kill)
echo [INFO] Checking if port 3000 is occupied...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    if not "%%a"=="" (
        echo [INFO] Found process ID %%a running on port 3000. Terminating...
        taskkill /f /pid %%a
    )
)

:: ตรวจสอบ node_modules
if not exist node_modules (
    echo [INFO] node_modules not found. Installing dependencies...
    call npm install
    echo [INFO] Dependencies installed successfully.
    echo.
)

:: รันเซิร์ฟเวอร์
echo [INFO] Starting the server...
call npm start

pause