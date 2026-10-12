# Start ADALib Studio: the API server also serves the built frontend.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\start.ps1 [-Port 8000]
param([int]$Port = 8000)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path "$root\frontend\dist\index.html")) {
    Write-Warning "frontend/dist not found - run scripts\setup.ps1 (or 'npm run build' in frontend) first."
}
Push-Location "$root\backend"
try {
    Write-Host "ADALib Studio -> http://127.0.0.1:$Port"
    .\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port $Port
} finally {
    Pop-Location
}
