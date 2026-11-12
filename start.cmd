@echo off
rem Double-click this file to run the Life Dashboard on your computer.
cd /d "%~dp0"
start "" http://localhost:5173
node tools\serve.mjs
