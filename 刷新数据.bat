@echo off
setlocal
cd /d "%~dp0" 2>nul
if not errorlevel 1 goto :RUN
pushd "%~dp0" 2>nul
if not errorlevel 1 goto :RUN
for %%D in (Z Y X W V) do (
  net use %%D: "\\172.16.10.3\供&销资料同步\店铺数据源\抖音店铺数据源\抖音店铺-看板" /persistent:no >nul 2>&1
  if not errorlevel 1 (%%D: & goto :RUN)
)
echo [ERROR] Cannot access network.
pause
exit /b 1
:RUN
echo Refreshing douyin dashboard data...
python "生成看板数据.py"
if not errorlevel 1 (
  where git >nul 2>&1
  if not errorlevel 1 (
    echo Pushing to GitHub...
    git add -A
    git commit -m "auto: data update" >nul 2>&1
    git push
    if not errorlevel 1 (echo Done!) else (echo [WARN] Git push failed.)
  ) else (echo [WARN] Git not installed, skip push.)
) else (echo [ERROR] Script failed & pause)
:END
pause
