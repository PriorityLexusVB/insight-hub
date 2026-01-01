#!/usr/bin/env bash
set -euo pipefail

ZIP_PATH="${1:-}"
if [[ -z "$ZIP_PATH" ]]; then
  echo "Usage: bash scripts/restore_at_home.sh <path-to-insight_current_report.zip>"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[1/3] Unzipping into repo root: $REPO_ROOT"
unzip -o "$ZIP_PATH" -d "$REPO_ROOT" >/dev/null

test -f "analytics/_current/index.html" || { echo "ERROR: analytics/_current/index.html missing after unzip"; exit 1; }

echo "[2/3] Opening dashboard..."
WIN_DASH="$(wslpath -w "$REPO_ROOT/analytics/_current/index.html")"
cmd.exe /c start "" "$WIN_DASH" >/dev/null 2>&1 || true

echo "[3/3] Done."
echo "Dashboard: analytics/_current/index.html"
