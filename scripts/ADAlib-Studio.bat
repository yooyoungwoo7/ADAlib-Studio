@echo off
rem ADALib Studio launcher for Windows: double-click to run.
rem First run: creates %USERPROFILE%\adalib-studio\venv and installs adalib-IFL (which includes ADALib Studio) from PyPI.
rem Later runs: starts the app. Run "ADAlib-Studio.bat update" to upgrade.
setlocal
set "HOME_DIR=%USERPROFILE%\adalib-studio"
set "VENV=%HOME_DIR%\venv"
set "PY=%VENV%\Scripts\python.exe"

if not exist "%PY%" (
    echo Installing ADALib Studio into %VENV% ^(first run, downloads about 2 GB^)...
    where py >nul 2>nul && (py -3 -m venv "%VENV%") || (python -m venv "%VENV%")
    if not exist "%PY%" (
        echo.
        echo Python 3.10+ was not found. Install it from https://www.python.org/downloads/
        echo ^(tick "Add python.exe to PATH"^) and run this file again.
        pause
        exit /b 1
    )
    "%PY%" -m pip install --upgrade pip
    "%PY%" -m pip install "adalib-IFL>=0.1.1" || goto :failed
) else if /i "%~1"=="update" (
    "%PY%" -m pip install --upgrade "adalib-IFL>=0.1.1" || goto :failed
)

set "ARGS=%*"
if /i "%~1"=="update" set "ARGS="
"%PY%" -m adalib_studio %ARGS%
if errorlevel 1 pause
exit /b

:failed
echo.
echo Installation failed; see the messages above.
pause
exit /b 1
