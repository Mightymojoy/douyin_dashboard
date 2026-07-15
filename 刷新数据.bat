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
if errorlevel 1 goto :FAIL
copy /Y "douyin_dashboard_embedded.html" "index.html" >nul 2>&1
set "GIT=C:\Program Files\Git\cmd\git.exe"
if not exist "%GIT%" echo [WARN] Git not found, skip push. & goto :END
set GIT_TERMINAL_PROMPT=0
echo Pushing to GitHub...
"%GIT%" rebase --abort >nul 2>&1
"%GIT%" fetch origin 2>nul
"%GIT%" checkout -B master origin/master 2>nul
"%GIT%" add -A
"%GIT%" commit -m "auto: data update" --allow-empty >nul 2>&1
"%GIT%" push -u origin master
if not errorlevel 1 (echo Done!) else echo [WARN] Git push failed.
goto :END
:FAIL
echo [ERROR] Script failed & pause
:END
pause
