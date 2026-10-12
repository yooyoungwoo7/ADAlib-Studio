"""Copy ADALib Studio into an ADAF_Library checkout, which ships it inside adalib-IFL.

    backend\\.venv\\Scripts\\python scripts\\sync_to_adalib.py "C:\\...\\ADAF_Library"
    backend\\.venv\\Scripts\\python scripts\\sync_to_adalib.py "C:\\...\\ADAF_Library" --skip-npm

Builds the frontend, then replaces <ADAF_Library>/adalib_studio with backend/app
(the Python package, imported there as ``adalib_studio``) plus frontend/dist as
adalib_studio/static. This repo stays the source; never edit the copy. Then build
adalib-IFL in ADAF_Library as usual (``python -m build``).
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "backend" / "app"
FRONTEND = ROOT / "frontend"

NOTICE = """\
# Generated copy of ADALib Studio. Do not edit.

The source is the ADAlib Studio repository (backend/app + frontend). Change it
there and run its scripts/sync_to_adalib.py to refresh this directory.
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("library", type=Path, help="ADAF_Library checkout (contains adalib/ and pyproject.toml)")
    ap.add_argument("--skip-npm", action="store_true", help="use the existing frontend/dist")
    args = ap.parse_args()

    lib = args.library.resolve()
    pyproject = lib / "pyproject.toml"
    is_library = (lib / "adalib").is_dir() and pyproject.is_file() and \
        'name = "adalib-IFL"' in pyproject.read_text(encoding="utf-8", errors="ignore")
    if not is_library:
        print(f"{lib} is not an ADAF_Library checkout (adalib/ and the adalib-IFL pyproject.toml)", file=sys.stderr)
        return 1

    if not args.skip_npm:
        print("+ npm run build", flush=True)
        subprocess.run("npm run build", cwd=FRONTEND, check=True, shell=True)
    dist = FRONTEND / "dist"
    if not (dist / "index.html").is_file():
        print("frontend/dist/index.html missing: run without --skip-npm", file=sys.stderr)
        return 1

    target = lib / "adalib_studio"
    shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(APP, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "static"))
    shutil.copytree(dist, target / "static")
    (target / "GENERATED.md").write_text(NOTICE, encoding="utf-8")
    n = sum(1 for p in target.rglob("*") if p.is_file())
    print(f"Synced {n} files into {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
