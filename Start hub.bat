@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node is niet geinstalleerd.
  echo.
  echo   Haal het op bij https://nodejs.org ^(kies de LTS-versie^),
  echo   installeer het, en dubbelklik dit bestand daarna opnieuw.
  echo.
  pause
  exit /b 1
)
node hub\server.mjs
echo.
pause
