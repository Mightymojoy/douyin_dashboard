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
set "PY=C:\Users\QwQ\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if not exist "%PY%" (
  echo [ERROR] Python not found: %PY%
  pause
  exit /b 1
)

echo [1/4] Generating dashboard data...
"%PY%" "%~dp0生成看板数据.py"
if errorlevel 1 goto :FAIL

echo [2/4] Injecting update timeline...
"%PY%" "%~dp0update_timeline.py" "%~dp0douyin_dashboard_embedded.html" --status ok --note "抖音店铺看板数据更新"
if errorlevel 1 goto :FAIL

echo [3/4] Copying embedded to index.html...
copy /Y "%~dp0douyin_dashboard_embedded.html" "%~dp0index.html" >nul 2>&1
if errorlevel 1 goto :FAIL

echo [4/4] Pushing to GitHub...
set "GIT=C:\Users\QwQ\.workbuddy\binaries\PortableGit\versions\1.2.0\mingw64\bin\git.exe"
if not exist "%GIT%" (
  echo [WARN] Git not found, skip push.
  goto :END
)
cd /d "%~dp0"
"%GIT%" fetch origin 2>&1
"%GIT%" rebase --abort 2>nul
"%GIT%" pull --rebase --autostash origin master 2>&1
"%GIT%" add -A
"%GIT%" commit -m "auto: data update" --allow-empty >nul 2>&1
"%GIT%" push -u origin master 2>&1
if errorlevel 1 (
  echo [WARN] Git push failed. Check network/credentials.
) else (
  echo Done! Dashboard data refreshed and pushed.
)
goto :END

:FAIL
echo [ERROR] Script failed. Check output above.
pause
exit /b 1

:END
echo.
echo Refresh finished.
pause
