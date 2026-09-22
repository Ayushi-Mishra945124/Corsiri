@echo off
setlocal
cd /d "%~dp0"
echo ===================================================
echo           Starting XCursor-AI Demo Stack
echo ===================================================
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\run-demo.ps1" -SkipNpmInstall
