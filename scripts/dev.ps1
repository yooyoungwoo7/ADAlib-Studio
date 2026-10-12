# Development: API with auto-reload on :8000 (new window) + Vite dev server on :5173.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$root\backend'; .\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app"
Push-Location "$root\frontend"
try { npm run dev } finally { Pop-Location }
