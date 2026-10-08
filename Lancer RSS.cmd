@echo off
setlocal
title Lancer RSS
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\lancer-rss.ps1"
if errorlevel 1 (
  echo.
  echo Le demarrage a echoue. Consultez le message ci-dessus.
  pause
)
endlocal
