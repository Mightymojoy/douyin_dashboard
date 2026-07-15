@echo off
cd /d "%~dp0"
echo Copying data sources from network...
copy /Y "\\172.16.10.3\\供&销资料同步\\店铺数据源\\抖音店铺数据源\\抖音自营店铺数据源.xlsx" . >nul 2>&1
if errorlevel 1 (
  echo [WARN] Failed to copy shop data source.
)
echo Refreshing douyin dashboard data...
python 生成看板数据.py
if errorlevel 1 (
  echo [ERROR] Python script failed.
  pause
  exit /b 1
)
echo Done!
pause
