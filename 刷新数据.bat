@echo off
cd /d "%~dp0"
echo 正在刷新抖音看板数据...
python 生成看板数据.py
echo.
echo 完成！
echo   - douyin_dashboard.html（开发版，加载外挂JS）
echo   - douyin_dashboard_embedded.html（自包含版，双击可直接打开）
pause
