@echo off
rem =====================================================================
rem  CHANDRA ERP BILLING — INSTALLER BUILDER (double-click karo, bas)
rem  Yeh file apne Windows PC par chalao: ye Node check karega,
rem  dependencies install karega, aur one-click installer .exe bana kar
rem  dist-installer folder khol dega.
rem  (Internet sirf isi ek baar chahiye; bani hui .exe hamesha offline hai)
rem =====================================================================
title Chandra ERP - Installer Builder
cd /d "%~dp0"
echo.
echo  ================================================
echo    CHANDRA ERP BILLING - INSTALLER BUILDER
echo  ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] Node.js install nahi hai!
    echo  1. https://nodejs.org kholiye
    echo  2. "LTS" wala green button dabaiye aur install kijiye
    echo  3. Phir yeh file dobara double-click kijiye
    echo.
    pause
    exit /b 1
)

echo  [1/2] Dependencies install ho rahi hain (ek baar)...
call npm install
if errorlevel 1 (
    echo.
    echo  [ERROR] npm install fail hua. Internet check karke dobara chalayein.
    pause
    exit /b 1
)

echo.
echo  [2/2] Installer ban raha hai (kuch minute)...
call npm run dist
if errorlevel 1 (
    echo.
    echo  [ERROR] Build fail hua. Upar wali lines ka screenshot bhejein.
    pause
    exit /b 1
)

echo.
echo  ================================================
echo    BAN GAYA! Installer is folder mein hai:
echo    %~dp0dist-installer\
echo  ================================================
explorer "%~dp0dist-installer"
echo.
pause
