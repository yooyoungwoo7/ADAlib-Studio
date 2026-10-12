# One-time setup: backend venv with adalib-IFL from PyPI, frontend packages and build.
# Usage (from the project root):  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location "$root\backend"
if (-not (Test-Path ".venv")) { python -m venv .venv }
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -r requirements.txt
Pop-Location

Push-Location "$root\frontend"
npm install
npm run build
Pop-Location

Write-Host "Setup complete. Start the app with: powershell -ExecutionPolicy Bypass -File scripts\start.ps1"
