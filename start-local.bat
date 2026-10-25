@echo off
REM Eden Awards local launcher: installs (first run), seeds sample data (first run),
REM builds, and starts the app at http://localhost:8787 (site + API in one process).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22.13+ is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo Installing dependencies... & call npm install || (pause & exit /b 1))
if not exist data\eden-awards.sqlite (call npm run setup || (pause & exit /b 1))
echo Building...
call npm run build || (pause & exit /b 1)
set APP_ORIGIN=http://localhost:8787
echo.
echo Eden Awards is running at http://localhost:8787  (close this window to stop it)
call npm start
pause
