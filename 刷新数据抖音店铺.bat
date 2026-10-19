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
REM ====================================================================
REM 动态定位 Python.exe【禁止写死版本号或安装目录】
REM   平台重装会删除 envs\default；versions\ 下是符号链接且版本号会变。
REM   优先级：环境变量 ITO_PYTHON -> venv(唯一带 pandas/openpyxl) -> versions\current
REM   绝不兜底 WindowsApps\python.exe（商店 stub，运行会弹窗卡住无人值守）
REM ====================================================================
set "PYTHON="
set "PYVENV=C:\Users\QwQ\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
set "PYVER=C:\Users\QwQ\.workbuddy\binaries\python\versions"
set "PYCV="

if defined ITO_PYTHON if exist "%ITO_PYTHON%" set "PYTHON=%ITO_PYTHON%"
if defined PYTHON goto PY_READY

if exist "%PYVENV%" set "PYTHON=%PYVENV%"
if defined PYTHON goto PY_READY

if exist "%PYVER%\current" for /f "usebackq delims=" %%V in ("%PYVER%\current") do set "PYCV=%%V"
if defined PYCV if exist "%PYVER%\%PYCV%\python.exe" set "PYTHON=%PYVER%\%PYCV%\python.exe"
if defined PYTHON goto PY_READY

echo [X] 找不到可用的 Python.exe！
echo     已尝试：环境变量 ITO_PYTHON、venv、versions\current
echo     修复建议：重装 WorkBuddy 后重建虚拟环境
echo     本次未执行任何生成/推送，数据未被改动。
pause
exit /b 1

:PY_READY
echo [i] 使用 Python: %PYTHON%
if /i not "%PYTHON%"=="%PYVENV%" (
    echo [!] 警告：当前不是标准 venv，可能缺少 pandas/openpyxl
    echo     若报 ModuleNotFoundError，请重建 venv 后重跑本脚本
)
echo.

echo [1/4] Generating dashboard data...
"%PYTHON%" "%~dp0生成看板数据.py"
if errorlevel 1 goto :FAIL

echo [2/4] Injecting update timeline...
"%PYTHON%" "%~dp0update_timeline.py" "%~dp0douyin_dashboard_embedded.html" --status ok --note "抖音店铺看板数据更新"
if errorlevel 1 goto :FAIL

echo [3/4] Copying embedded to index.html...
copy /Y "%~dp0douyin_dashboard_embedded.html" "%~dp0index.html" >nul 2>&1
if errorlevel 1 goto :FAIL

echo [4/4] Pushing to GitHub...
rem [FIX 20261012] PortableGit runtime probe - avoid hardcoded version dir.
set "GITBASE=C:\Users\QwQ\.workbuddy\binaries\PortableGit\versions"
set "GIT="
if exist "%GITBASE%\current" for /f "usebackq delims=" %%V in ("%GITBASE%\current") do if not defined GIT if exist "%GITBASE%\%%V\mingw64\bin\git.exe" set "GIT=%GITBASE%\%%V\mingw64\bin\git.exe"
if not defined GIT for /f "delims=" %%D in ('dir /b /ad /o-n "%GITBASE%" 2^>nul') do (
    if not defined GIT if exist "%GITBASE%\%%D\mingw64\bin\git.exe" set "GIT=%GITBASE%\%%D\mingw64\bin\git.exe"
)
if not defined GIT for /f "delims=" %%P in ('where git 2^>nul') do (
    if not defined GIT set "GIT=%%P"
)
if not defined GIT (
  echo [X] 找不到可用的 git.exe，本次数据未推送！
  echo     已尝试：versions\current、versions\*（按版本倒序）、where git
  echo     本地数据已生成，但线上看板不会更新。
  echo     修复建议：重装 WorkBuddy 或安装 Git 后重跑本脚本。
  pause
  exit /b 1
)
cd /d "%~dp0"
"%GIT%" fetch origin 2>&1
"%GIT%" rebase --abort 2>nul
"%GIT%" pull --rebase --autostash origin master 2>&1
"%GIT%" add -A
"%GIT%" diff --cached --quiet
if errorlevel 1 (
  "%GIT%" commit -m "auto: data update"
  if errorlevel 1 (
    echo [X] git commit 失败，本次未推送。
    pause
    exit /b 1
  )
) else (
  echo [i] 暂存区无变化，跳过提交（属正常，非错误）
)

set "LOCAL_SHA="
set "REMOTE_SHA="
for /f "usebackq delims=" %%L in (`"%GIT%" rev-parse HEAD 2^>nul`) do set "LOCAL_SHA=%%L"
echo [i] 本地 HEAD: %LOCAL_SHA%

"%GIT%" push -u origin master 2>&1
if errorlevel 1 (
  echo [X] git push 失败，线上看板仍是旧数据。
  echo     排查：1) 网络  2) 凭据 运行桌面「修复GitHub推送凭据.bat」  3) 代理
  pause
  exit /b 1
)

"%GIT%" fetch origin master >nul 2>&1
for /f "usebackq delims=" %%R in (`"%GIT%" rev-parse origin/master 2^>nul`) do set "REMOTE_SHA=%%R"
echo [i] 远端 origin/master: %REMOTE_SHA%
if /i not "%LOCAL_SHA%"=="%REMOTE_SHA%" (
  echo [X] 推送核验失败：本地与远端 sha 不一致，线上可能未更新。
  pause
  exit /b 1
)
echo [OK] 推送核验通过（本地 = 远端）
goto :END

:FAIL
echo [ERROR] Script failed. Check output above.
pause
exit /b 1

:END
echo.
echo Refresh finished.
pause
