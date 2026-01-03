#!/usr/bin/env bash
set -euo pipefail

# Source repo root assertion
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/assert_repo_root.sh"

cd "$INSIGHT_HUB_ROOT"

echo "==> 1) Ensure NotebookLM ignores exist"
if [ -f scripts/ensure_gitignore_notebooklm.mjs ]; then
  node scripts/ensure_gitignore_notebooklm.mjs || true
fi

echo "==> 2) Regenerate analytics (_current)"
pnpm -C apps/indexer-cli start -- analyze --out analytics/_current --emit-rollup --emit-html

echo "==> 3) Regenerate packets (generated; not committed)"
node scripts/notebooklm_packets_bootstrap.mjs --force

echo "==> 4) Regenerate upload plan + materialized folders (generated; not committed)"
rm -rf notebooklm_upload NOTEBOOKLM_UPLOAD_PLAN.md 2>/dev/null || true
node scripts/notebooklm_upload_plan.mjs --top 15 --max-sources 50 --out NOTEBOOKLM_UPLOAD_PLAN.md --materialize notebooklm_upload --copy

echo "==> 5) Build GitHub bundle sources (committed)"
node scripts/notebooklm_make_bundles.mjs

echo "==> 6) Stage commitable changes (scripts + bundles only)"
git add scripts/ notebooklm_bundles/ || true

echo ""
echo "✅ NotebookLM refresh complete."
echo "Next:"
echo "  git status"
echo "  git commit -m \"Update NotebookLM bundles\""
echo "  git push"
