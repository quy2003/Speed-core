@echo off
cd /d "%~dp0"
echo Starting Speed Core at http://127.0.0.1:3000
echo Keep this window open while using the app.
echo.
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
echo.
echo The dev server stopped. Check the message above for details.
pause
