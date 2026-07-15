@echo off
setlocal
cd /d "e:\抖音店铺-看板" 2>nul
if errorlevel 1 (echo [ERROR] Project not found. & pause & exit /b 1)
echo Copying data sources from network...
copy /Y "\\172.16.10.3\供&销资料同步\店铺数据源\抖音店铺数据源\抖音自营店铺数据源.xlsx" . >nul 2>&1
if errorlevel 1 (echo [WARN] Failed to copy, using local.)
echo Refreshing...
python 生成看板数据.py
if errorlevel 1 (echo [ERROR] & pause & exit /b 1)
echo Done!
pause
