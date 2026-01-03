#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BR="$(git branch --show-current)"
ORIGIN="$(git config --get remote.origin.url)"

# normalize origin -> OWNER/REPO
OWNER_REPO="$(
  echo "$ORIGIN" \
  | sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##'
)"

BUNDLE_DIR="notebooklm_bundles"

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "Missing $BUNDLE_DIR/. Run: node scripts/notebooklm_make_bundles.mjs"
  exit 2
fi

echo "Branch: $BR"
echo "Repo:   $OWNER_REPO"
echo ""

echo "== Raw URLs (preferred) =="
for f in "$BUNDLE_DIR"/*.md; do
  rel="${f#./}"
  echo "https://raw.githubusercontent.com/$OWNER_REPO/$BR/$rel"
done

echo ""
echo "== Fallback URLs (github.com/raw) =="
for f in "$BUNDLE_DIR"/*.md; do
  rel="${f#./}"
  echo "https://github.com/$OWNER_REPO/raw/$BR/$rel"
done

echo ""
echo "== Fallback URLs (blob?raw=1) =="
for f in "$BUNDLE_DIR"/*.md; do
  rel="${f#./}"
  echo "https://github.com/$OWNER_REPO/blob/$BR/$rel?raw=1"
done
