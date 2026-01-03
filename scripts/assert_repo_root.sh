#!/usr/bin/env bash
# scripts/assert_repo_root.sh
# Fail if not running from insight-hub repo root.
# Usage: source scripts/assert_repo_root.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_NAME="$(basename "$REPO_ROOT")"

if [[ "$REPO_NAME" != "insight-hub" ]]; then
  echo "ERROR: Not in insight-hub repository root. Current: $REPO_ROOT" >&2
  echo "Expected directory name: insight-hub" >&2
  exit 1
fi

if [[ ! -f "$REPO_ROOT/package.json" ]] || [[ ! -d "$REPO_ROOT/apps/indexer-cli" ]]; then
  echo "ERROR: Missing expected files/directories. Not in insight-hub root?" >&2
  exit 1
fi

# Export for use by other scripts
export INSIGHT_HUB_ROOT="$REPO_ROOT"
