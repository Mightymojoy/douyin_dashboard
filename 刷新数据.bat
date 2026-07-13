@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在刷新抖音看板数据...
python 生成看板数据.py
if errorlevel 1 (
  echo.
  echo [错误] Python 脚本执行失败，请检查上方报错信息
  pause
  exit /b 1
)
echo.
echo 完成！
echo   - douyin_dashboard_embedded.html (数据内嵌版，双击可直接打开)
echo   - index.html (GitHub Pages 部署版)
pause
