@echo off
setlocal
set "RESOURCES_DIR=%~dp0.."
set "ELECTRON_RUN_AS_NODE=1"
"%RESOURCES_DIR%\..\Audio-V.exe" "%RESOURCES_DIR%\app.asar\dist-electron\electron\cli.js" %*
exit /b %ERRORLEVEL%
