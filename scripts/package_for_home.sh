#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

OUT_DIR="analytics/_current"

# Resolve Windows Desktop path dynamically (no hardcoded username)
WIN_USERPROFILE="$(cmd.exe /c echo %USERPROFILE% 2>/dev/null | tr -d '\r')"
DESKTOP_ZIP_W="$WIN_USERPROFILE\\Desktop\\insight_current_report.zip"
DESKTOP_ZIP="$(wslpath -u "$DESKTOP_ZIP_W")"

echo "[1/3] Rebuilding dashboard (_current)..."
node apps/indexer-cli/dist/index.js analyze --out "$OUT_DIR" --emit-rollup --emit-html

test -f "$OUT_DIR/index.html" || { echo "ERROR: $OUT_DIR/index.html missing"; exit 1; }

echo "[2/3] Zipping report bundle to Desktop..."
zip -r "$DESKTOP_ZIP" "$OUT_DIR" >/dev/null

echo "[3/3] Done."
ls -lh "$DESKTOP_ZIP"
echo "Windows path: ${DESKTOP_ZIP_W}"
