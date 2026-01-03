#!/usr/bin/env bash
# scripts/triage_apply_patch.sh
# Safely apply a triage patch with 3-way merge and conflict detection.
#
# Usage:
#   bash scripts/triage_apply_patch.sh <patch_file> [--dry-run]

set -euo pipefail

# Source repo root assertion
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/assert_repo_root.sh"

cd "$INSIGHT_HUB_ROOT"

PATCH_FILE="${1:-}"
DRY_RUN="${2:-}"

if [[ -z "$PATCH_FILE" ]]; then
  echo "Usage: bash scripts/triage_apply_patch.sh <patch_file> [--dry-run]"
  exit 1
fi

if [[ ! -f "$PATCH_FILE" ]]; then
  echo "ERROR: Patch file not found: $PATCH_FILE"
  exit 1
fi

# Extract batch ID from patch filename
BATCH_ID="001"
if [[ "$PATCH_FILE" =~ route_suggestions_([0-9]+) ]]; then
  BATCH_ID="${BASH_REMATCH[1]}"
fi

BRANCH_NAME="triage-apply-${BATCH_ID}"

echo "==> Triage Patch Application"
echo "Patch file: $PATCH_FILE"
echo "Batch ID: $BATCH_ID"
echo "Branch name: $BRANCH_NAME"
echo ""

# Check if patch is empty
PATCH_SIZE=$(wc -c < "$PATCH_FILE")
if [[ "$PATCH_SIZE" -eq 0 ]]; then
  echo "ERROR: Patch file is empty (0 bytes)"
  exit 1
fi

# Dry run check first
echo "==> Step 1: Checking patch (dry-run)..."
if ! git apply --check --recount --3way "$PATCH_FILE" 2>&1; then
  echo ""
  echo "❌ Patch check FAILED"
  echo ""
  echo "The patch cannot be applied cleanly. Possible reasons:"
  echo "- Files have been modified since the patch was generated"
  echo "- Patch was generated from a different branch"
  echo "- Format issues in the patch file"
  echo ""
  echo "To investigate:"
  echo "  git apply --check --verbose --recount --3way '$PATCH_FILE'"
  exit 1
fi

echo "✓ Patch check passed"

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo ""
  echo "✅ Dry-run complete. Patch can be applied."
  echo ""
  echo "To apply for real:"
  echo "  bash scripts/triage_apply_patch.sh '$PATCH_FILE'"
  exit 0
fi

# Check current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo ""
echo "==> Step 2: Creating branch..."
echo "Current branch: $CURRENT_BRANCH"

# Check if branch exists
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "WARNING: Branch $BRANCH_NAME already exists"
  echo ""
  read -p "Delete and recreate? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git branch -D "$BRANCH_NAME"
  else
    echo "Aborted."
    exit 1
  fi
fi

git checkout -b "$BRANCH_NAME"
echo "✓ Created and switched to branch: $BRANCH_NAME"

# Apply patch
echo ""
echo "==> Step 3: Applying patch..."
if ! git apply --recount --3way "$PATCH_FILE" 2>&1; then
  echo ""
  echo "❌ Patch application FAILED"
  echo ""
  echo "Checking for reject files..."
  REJECTS=$(find . -name "*.rej" 2>/dev/null || true)
  if [[ -n "$REJECTS" ]]; then
    echo "Reject files found:"
    echo "$REJECTS"
    echo ""
    echo "These files have conflicts that could not be automatically resolved."
    echo "You must manually resolve them."
  fi
  echo ""
  echo "Current status:"
  git status
  echo ""
  echo "To recover:"
  echo "  git checkout $CURRENT_BRANCH"
  echo "  git branch -D $BRANCH_NAME"
  exit 1
fi

echo "✓ Patch applied successfully"

# Check for rejects anyway (shouldn't happen, but be safe)
REJECTS=$(find . -name "*.rej" 2>/dev/null || true)
if [[ -n "$REJECTS" ]]; then
  echo ""
  echo "⚠️  WARNING: Reject files found after application:"
  echo "$REJECTS"
  echo ""
  echo "Some changes may not have been applied cleanly."
fi

# Show status
echo ""
echo "==> Step 4: Verifying changes..."
git status
echo ""

# Count changed files
CHANGED_COUNT=$(git diff --name-only | wc -l)
echo "Files changed: $CHANGED_COUNT"

if [[ "$CHANGED_COUNT" -eq 0 ]]; then
  echo ""
  echo "⚠️  WARNING: No files changed. Patch may have been already applied."
  echo ""
  echo "This is OK if the patch was idempotent."
else
  echo ""
  echo "✅ Patch applied successfully to branch: $BRANCH_NAME"
  echo ""
  echo "Next steps:"
  echo "  1. Review changes: git diff"
  echo "  2. Run analyze to verify triage_count change"
  echo "  3. Commit if satisfied: git add . && git commit -m 'Apply triage batch $BATCH_ID'"
  echo "  4. Merge back: git checkout $CURRENT_BRANCH && git merge $BRANCH_NAME"
  echo "  5. Clean up: git branch -d $BRANCH_NAME"
fi
