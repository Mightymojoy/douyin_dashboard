@echo off
setlocal
cd /d "e:\抖音店铺-看板" 2>nul
if errorlevel 1 (echo [ERROR] & pause & exit /b 1)
echo Refreshing...
python 生成看板数据.py
if errorlevel 1 (echo [ERROR] & pause & exit /b 1)
echo Pushing to GitHub...
git add -A
git commit -m "auto: data update" >nul 2>&1
git push
if errorlevel 1 (echo [WARN] Git push failed.)
echo Done!
pause
