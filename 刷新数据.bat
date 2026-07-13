@echo off
cd /d "%~dp0"
echo Refreshing douyin dashboard data...
python 生成看板数据.py
if errorlevel 1 (
  echo [ERROR] Python script failed.
  pause
  exit /b 1
)
echo Done!
pause
