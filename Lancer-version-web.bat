@echo off
rem Version web du Laboratoire de Frost : ouvre http://localhost:5178 dans le navigateur.
cd /d "%~dp0"
if not exist node_modules (
  echo Premiere installation des dependances...
  call npm install
)
start "" http://localhost:5178
call npm run dev
