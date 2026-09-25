@echo off
setlocal
cd /d "%~dp0"
title BotWorks Command Center

echo ==============================================================================
echo             BOTWORKS COMMAND CENTER — OPERATIONS BOT
echo                 Autonomous Agency Lead & Sentinel Engine
echo ==============================================================================
echo.

:: Check Node.js installation
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js 20 from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [1/3] Node.js environment detected:
node -v
echo.

:: Check node_modules
if not exist "node_modules\" (
    echo [2/3] node_modules missing. Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install npm dependencies.
        pause
        exit /b 1
    )
) else (
    echo [2/3] Dependencies verified.
)
echo.

:: Check .env configuration
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env >nul
        echo [3/3] Created .env from .env.example.
    )
)

echo [3/3] Launching BotWorks Command Center...
echo ==============================================================================
node bot.js

if %errorlevel% neq 0 (
    echo.
    echo [SYSTEM] Process exited with error code %errorlevel%.
    pause
)
