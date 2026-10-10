@echo off
rem Version bureau du Laboratoire de Frost (Windows).
cd /d "%~dp0"
if not exist node_modules (
  echo Premiere installation des dependances...
  call npm install
)
call npm run desktop
