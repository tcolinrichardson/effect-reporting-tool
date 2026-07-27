@echo off
title Bayesian Reporting Tool - Local Server
cd /d "%~dp0"
echo Serving the app at http://localhost:8000/
echo Close this window to stop the server.
echo.
python -m http.server 8000
