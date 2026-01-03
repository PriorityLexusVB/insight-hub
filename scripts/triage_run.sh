#!/usr/bin/env bash
# scripts/triage_run.sh
# End-to-end triage workflow with guardrails and validation.
#
# Usage:
#   bash scripts/triage_run.sh [--batch-id 001] [--limit 200] [--threshold 0.75] [--dry-run] [--apply]

set -euo pipefail

# Source repo root assertion
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/assert_repo_root.sh"

cd "$INSIGHT_HUB_ROOT"

# Parse arguments
BATCH_ID="001"
LIMIT="150"
THRESHOLD="0.75"
DRY_RUN="false"
APPLY="false"
INDEXED_MODE="false"

while [[ $# -gt 0 ]]; do
  case $1 in
    --batch-id)
      BATCH_ID="$2"
      shift 2
      ;;
    --limit)
      LIMIT="$2"
      shift 2
      ;;
    --threshold)
      THRESHOLD="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --apply)
      APPLY="true"
      shift
      ;;
    --indexed)
      INDEXED_MODE="true"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: bash scripts/triage_run.sh [--batch-id 001] [--limit 200] [--threshold 0.75] [--dry-run] [--apply] [--indexed]"
      exit 1
      ;;
  esac
done

# Ensure 3-digit batch ID
BATCH_ID=$(printf "%03d" "$BATCH_ID")

TRIAGE_DIR="analytics/_current/triage"
QUEUE_FILE="$TRIAGE_DIR/unknown_queue_${BATCH_ID}.json"
BATCH_FILE="$TRIAGE_DIR/triage_batch_${BATCH_ID}.md"
SUGGESTIONS_FILE="$TRIAGE_DIR/triage_suggestions_${BATCH_ID}.jsonl"

echo "═══════════════════════════════════════════════════════════════"
echo "  Insight Hub — Triage Run (Batch $BATCH_ID)"
echo "═══════════════════════════════════════════════════════════════"
echo "Limit: $LIMIT"
echo "Threshold: $THRESHOLD"
echo "Dry-run: $DRY_RUN"
echo "Apply: $APPLY"
echo "Indexed mode: $INDEXED_MODE"
echo ""

# Step 1: Generate batch
echo "==> Step 1: Generating triage batch..."
node scripts/triage_unknowns_make_batch.mjs \
  --in analytics/_current/chat_index.json \
  --threads thread-vault/threads \
  --out "$TRIAGE_DIR" \
  --limit "$LIMIT" \
  --unknownOnly \
  --batchId "$BATCH_ID"

if [[ ! -f "$QUEUE_FILE" ]]; then
  echo "ERROR: Queue file not created: $QUEUE_FILE"
  exit 1
fi

# Get queue count
QUEUE_LEN=$(node -e "const q=require('./$QUEUE_FILE'); const arr=Array.isArray(q)?q:q.items||q.threads||q.queue||[]; console.log(arr.length);")
echo "Queue length: $QUEUE_LEN"

# Get current triage_count
TRIAGE_COUNT=$(node -e "const r=require('./analytics/_current/chat_index.json'); console.log(r.filter(x=>x.domain==='unknown').length);" 2>/dev/null || echo "unknown")
echo "Current triage_count (unknown domain): $TRIAGE_COUNT"
echo ""

# Step 2: Indexed mode (optional)
if [[ "$INDEXED_MODE" == "true" ]]; then
  echo "==> Step 2a: Creating indexed batch (ID-proof workflow)..."
  node scripts/triage_index_batch.mjs \
    --queue "$QUEUE_FILE" \
    --out "$TRIAGE_DIR/unknown_queue_${BATCH_ID}_indexed.json" \
    --map "$TRIAGE_DIR/batch_index_map_${BATCH_ID}.json" \
    --batch "$TRIAGE_DIR/triage_batch_${BATCH_ID}_indexed.md"
  
  echo ""
  echo "✓ Indexed batch created"
  echo ""
  echo "NEXT STEPS (Indexed Mode):"
  echo "  1. Open: $TRIAGE_DIR/triage_batch_${BATCH_ID}_indexed.md"
  echo "  2. Paste into LLM (ChatGPT/Claude/Gemini) and request JSONL output"
  echo "  3. Save LLM output to: $TRIAGE_DIR/triage_suggestions_${BATCH_ID}_indexed.jsonl"
  echo "  4. Merge indexed suggestions:"
  echo "     node scripts/triage_merge_indexed_suggestions.mjs \\"
  echo "       --suggestions $TRIAGE_DIR/triage_suggestions_${BATCH_ID}_indexed.jsonl \\"
  echo "       --map $TRIAGE_DIR/batch_index_map_${BATCH_ID}.json \\"
  echo "       --out $SUGGESTIONS_FILE"
  echo "  5. Re-run this script without --indexed and with --apply"
  echo ""
  exit 0
fi

# Step 3: Check for suggestions file
echo "==> Step 2: Checking for suggestions file..."
if [[ ! -f "$SUGGESTIONS_FILE" ]]; then
  echo "⚠️  Suggestions file not found: $SUGGESTIONS_FILE"
  echo ""
  echo "NEXT STEPS:"
  echo "  1. Open: $BATCH_FILE"
  echo "  2. Paste into LLM (ChatGPT/Claude/Gemini) and request JSONL output"
  echo "  3. Save LLM output to: $SUGGESTIONS_FILE"
  echo "  4. Validate: node scripts/validate_jsonl.mjs $SUGGESTIONS_FILE"
  echo "  5. Re-run this script"
  echo ""
  echo "OR use indexed mode for ID-proof workflow:"
  echo "  bash scripts/triage_run.sh --batch-id $BATCH_ID --indexed"
  echo ""
  exit 0
fi

echo "✓ Suggestions file found"
echo ""

# Step 4: Validate suggestions
echo "==> Step 3: Validating suggestions..."
node scripts/validate_jsonl.mjs "$SUGGESTIONS_FILE"
echo ""

# Step 5: Generate patch with validation
echo "==> Step 4: Generating patch with guardrails..."
PATCH_FILE="thread-vault/patches/route_suggestions_${BATCH_ID}_$(printf "%03d" "$(echo "$THRESHOLD * 100" | bc | cut -d. -f1)").safe.patch"

node scripts/triage_unknowns_make_patch.mjs \
  --suggestions "$SUGGESTIONS_FILE" \
  --queue "$QUEUE_FILE" \
  --threads thread-vault/threads \
  --outPatch "$PATCH_FILE" \
  --minConfidence "$THRESHOLD"

if [[ ! -f "$PATCH_FILE" ]]; then
  echo "ERROR: Patch file not created: $PATCH_FILE"
  exit 1
fi

PATCH_SIZE=$(wc -c < "$PATCH_FILE")
echo "Patch size: $PATCH_SIZE bytes"
echo ""

# Step 6: Check patch report
REPORT_FILE="${PATCH_FILE%.patch}.report.json"
if [[ -f "$REPORT_FILE" ]]; then
  echo "==> Patch Report:"
  cat "$REPORT_FILE"
  echo ""
fi

# Step 7: Dry-run or apply
if [[ "$DRY_RUN" == "true" ]]; then
  echo "==> Step 5: Dry-run patch check..."
  bash scripts/triage_apply_patch.sh "$PATCH_FILE" --dry-run
  echo ""
  echo "✅ Dry-run complete. Everything looks good."
  echo ""
  echo "To apply the patch:"
  echo "  bash scripts/triage_run.sh --batch-id $BATCH_ID --apply"
  echo ""
  exit 0
fi

if [[ "$APPLY" == "true" ]]; then
  echo "==> Step 5: Applying patch..."
  bash scripts/triage_apply_patch.sh "$PATCH_FILE"
  
  echo ""
  echo "==> Step 6: Re-running analyze..."
  pnpm -C apps/indexer-cli start -- analyze --out analytics/_current --emit-rollup --emit-html
  
  echo ""
  echo "==> Step 7: Checking new triage_count..."
  NEW_TRIAGE_COUNT=$(node -e "const r=require('./analytics/_current/chat_index.json'); console.log(r.filter(x=>x.domain==='unknown').length);" 2>/dev/null || echo "unknown")
  echo "Previous triage_count: $TRIAGE_COUNT"
  echo "New triage_count: $NEW_TRIAGE_COUNT"
  
  if [[ "$TRIAGE_COUNT" != "unknown" ]] && [[ "$NEW_TRIAGE_COUNT" != "unknown" ]]; then
    DELTA=$((TRIAGE_COUNT - NEW_TRIAGE_COUNT))
    echo "Delta: $DELTA"
  fi
  
  echo ""
  echo "✅ Triage run complete!"
else
  echo "==> Next steps:"
  echo "  1. Review patch: git diff (if on triage branch)"
  echo "  2. Apply: bash scripts/triage_run.sh --batch-id $BATCH_ID --apply"
  echo "  OR dry-run first: bash scripts/triage_run.sh --batch-id $BATCH_ID --dry-run"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
