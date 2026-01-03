# Triage Loop Implementation Summary

## What Was Implemented

This implementation adds **comprehensive guardrails and automation** to the Insight Hub triage loop to prevent silent failures and ensure reliable operation.

---

## Files Added

### Core Scripts

1. **`scripts/assert_repo_root.sh`**
   - Validates repository root before any operations
   - Prevents accidental execution in wrong directory
   - Used by all automation scripts

2. **`scripts/triage_index_batch.mjs`**
   - Creates ID-proof batches using `batch_index` instead of `thread_uid`
   - Generates mapping file for later merge
   - Prevents LLM from inventing thread_uid values

3. **`scripts/triage_merge_indexed_suggestions.mjs`**
   - Merges indexed suggestions back to thread_uid
   - Uses mapping file from indexed batch
   - Part of ID-proof workflow

4. **`scripts/triage_apply_patch.sh`**
   - Safe patch application with 3-way merge
   - Creates dedicated branch for triage changes
   - Detects conflicts and provides recovery instructions
   - Includes dry-run mode

5. **`scripts/triage_run.sh`**
   - **One-command end-to-end triage automation**
   - Generates batch → validates suggestions → creates patch → applies changes
   - Supports dry-run and indexed modes
   - Shows triage_count delta after application

### Documentation

6. **`RUNBOOK_TRIAGE.md`**
   - Complete triage workflow documentation
   - Standard and ID-proof workflows
   - Troubleshooting guide
   - Command reference

---

## Files Modified

### Enhanced with Guardrails

1. **`scripts/triage_unknowns_make_patch.mjs`**
   - ✅ **Guardrail 1:** Validates suggestions match queue IDs (ok_matches check)
   - ✅ **Guardrail 2:** Refuses to write 0-byte patches
   - ✅ **Guardrail 3:** Stable patch naming: `route_suggestions_<BATCH>_<THRESH>.safe.patch`
   - ✅ **Guardrail 4:** Writes patch report JSON with full metadata
   - ✅ Added `--queue` parameter for validation
   - ✅ Added `--force` flag to bypass guardrails (when needed)

2. **`scripts/notebooklm_refresh.sh`**
   - Added repo-root assertion for safety
   - Consistent with other scripts

3. **`RUNBOOK.md`**
   - Added reference to new triage runbook
   - Updated triage section with quick start

4. **`RUNBOOK_NOTEBOOKLM.md`**
   - Added triage artifacts as optional sources
   - Cross-reference to triage runbook

---

## Guardrails Implemented

### 1. ID Validation (Prevents LLM Invention)
```bash
# Automatically validates suggestions against queue
# Fails if ok_matches = 0
node scripts/triage_unknowns_make_patch.mjs \
  --suggestions <file.jsonl> \
  --queue <queue.json> \
  --minConfidence 0.75
```

**Output if failed:**
```
❌ GUARDRAIL FAILURE: ok_matches = 0

Your suggestions thread_uid values do NOT match any queue thread_uid.
This means the LLM may have invented IDs or you're using the wrong queue.

DO NOT PROCEED. Fix your suggestions file or use --force to bypass.
```

### 2. Empty Patch Protection
```bash
# Refuses to write 0-byte patches
# Prevents no-op operations
```

**Output if failed:**
```
❌ GUARDRAIL FAILURE: patch is empty (0 bytes)

No changes detected. This could mean:
- All suggestions already applied (idempotent check passed)
- Confidence threshold too high
- Suggestions don't match any existing threads

Refusing to write empty patch. Use --force to bypass.
```

### 3. Stable Patch Naming
```
# Patches now include batch ID and threshold
thread-vault/patches/route_suggestions_001_075.safe.patch
thread-vault/patches/route_suggestions_001_075.safe.report.json
```

### 4. Patch Report Generation
```json
{
  "timestamp": "2026-01-03T04:15:00.000Z",
  "batch_id": "001",
  "suggestions_file": "analytics/_current/triage/triage_suggestions_001.jsonl",
  "queue_file": "analytics/_current/triage/unknown_queue_001.json",
  "suggestions_lines": 45,
  "ok_matches": 45,
  "min_confidence": 0.75,
  "files_changed": 42,
  "patch_path": "thread-vault/patches/route_suggestions_001_075.safe.patch",
  "patch_bytes": 18432
}
```

---

## Usage Examples

### Quick Start (Standard Workflow)

```bash
# 1. Generate batch and wait for suggestions
bash scripts/triage_run.sh --batch-id 001 --threshold 0.75

# ... paste triage_batch_001.md into LLM ...
# ... save output to triage_suggestions_001.jsonl ...

# 2. Apply patch with verification
bash scripts/triage_run.sh --batch-id 001 --apply
```

### ID-Proof Workflow (If LLM Invents IDs)

```bash
# 1. Generate indexed batch
bash scripts/triage_run.sh --batch-id 001 --indexed

# ... paste triage_batch_001_indexed.md into LLM ...
# ... save output to triage_suggestions_001_indexed.jsonl ...

# 2. Merge indexed suggestions
node scripts/triage_merge_indexed_suggestions.mjs \
  --suggestions analytics/_current/triage/triage_suggestions_001_indexed.jsonl \
  --map analytics/_current/triage/batch_index_map_001.json \
  --out analytics/_current/triage/triage_suggestions_001.jsonl

# 3. Apply patch
bash scripts/triage_run.sh --batch-id 001 --apply
```

### Manual Step-by-Step

```bash
# 1. Generate batch
node scripts/triage_unknowns_make_batch.mjs \
  --in analytics/_current/chat_index.json \
  --threads thread-vault/threads \
  --out analytics/_current/triage \
  --limit 150 \
  --unknownOnly \
  --batchId 001

# 2. Get LLM suggestions (manual)
# Open triage_batch_001.md, paste into LLM, save output

# 3. Validate suggestions
node scripts/validate_jsonl.mjs analytics/_current/triage/triage_suggestions_001.jsonl

# 4. Generate patch with guardrails
node scripts/triage_unknowns_make_patch.mjs \
  --suggestions analytics/_current/triage/triage_suggestions_001.jsonl \
  --queue analytics/_current/triage/unknown_queue_001.json \
  --threads thread-vault/threads \
  --minConfidence 0.75

# 5. Review patch report
cat thread-vault/patches/route_suggestions_001_075.safe.report.json

# 6. Apply patch (dry-run first)
bash scripts/triage_apply_patch.sh thread-vault/patches/route_suggestions_001_075.safe.patch --dry-run

# 7. Apply patch for real
bash scripts/triage_apply_patch.sh thread-vault/patches/route_suggestions_001_075.safe.patch

# 8. Verify and commit
git diff
git add thread-vault/threads/
git commit -m "Apply triage batch 001"

# 9. Re-run analysis
pnpm -C apps/indexer-cli start -- analyze --out analytics/_current --emit-rollup --emit-html
```

---

## Weekly Triage Workflow

```bash
# Step 1: Rebuild analytics
pnpm -C apps/indexer-cli start -- analyze --out analytics/_current --emit-rollup --emit-html

# Step 2: Check triage count
node -e "const r=require('./analytics/_current/chat_index.json'); console.log('unknown:', r.filter(x=>x.domain==='unknown').length);"

# Step 3: Run triage (if needed)
bash scripts/triage_run.sh --batch-id 002 --threshold 0.75

# Step 4: Get LLM suggestions (manual)
# ... use ChatGPT/Claude/Gemini with triage_batch_002.md ...

# Step 5: Apply changes
bash scripts/triage_run.sh --batch-id 002 --apply

# Step 6: Commit and push
git add analytics/_current/ thread-vault/threads/
git commit -m "Triage batch 002: reduced unknowns by X"
git push
```

---

## Verification Results

All scripts tested and verified:

✅ **Batch generation** - Creates queue and markdown for LLM  
✅ **Indexed batch creation** - ID-proof workflow with batch_index  
✅ **Indexed suggestions merge** - Maps batch_index back to thread_uid  
✅ **Patch generation** - Creates patches with guardrails  
✅ **ID validation** - Blocks mismatched thread_uid (ok_matches = 0)  
✅ **Empty patch protection** - Refuses to write 0-byte patches  
✅ **Patch report** - Generates detailed JSON report  
✅ **Patch application** - Safe application with 3-way merge  
✅ **Dry-run mode** - Tests patches before applying  
✅ **Build verification** - TypeScript build succeeds  

---

## Key Safety Features

1. **Repository Root Validation**
   - All scripts verify they're in the correct repo
   - Prevents accidental execution in wrong directory

2. **ID Proof Workflow**
   - Indexed mode prevents LLM from inventing thread_uid
   - Mapping file ensures correct ID translation

3. **Validation Before Application**
   - Queue validation ensures suggestions match expected threads
   - Patch check before application prevents conflicts

4. **Audit Trail**
   - Patch reports with full metadata
   - Stable patch naming with batch ID
   - Git history for all changes

5. **Recovery Procedures**
   - Clear error messages with solutions
   - Dry-run mode for testing
   - Rollback instructions in documentation

---

## Breaking Changes

None. All existing workflows continue to work. New features are opt-in:

- Old: `node scripts/triage_unknowns_make_patch.mjs --suggestions <file>`
- New: `node scripts/triage_unknowns_make_patch.mjs --suggestions <file> --queue <queue>`

The `--queue` parameter is optional but highly recommended for safety.

---

## Next Steps

1. **Run first triage with new workflow:**
   ```bash
   bash scripts/triage_run.sh --batch-id 001 --dry-run
   ```

2. **Review documentation:**
   - [RUNBOOK_TRIAGE.md](./RUNBOOK_TRIAGE.md) - Complete triage guide
   - [RUNBOOK.md](./RUNBOOK.md) - Main runbook with quick reference

3. **Weekly cadence:**
   - Run triage weekly or bi-weekly
   - Use threshold 0.75 for conservative approach
   - Lower to 0.70 or 0.60 for final sweeps

4. **NotebookLM integration:**
   ```bash
   bash scripts/notebooklm_refresh.sh
   ```

---

## Command Quick Reference

| Command | Purpose |
|---------|---------|
| `bash scripts/triage_run.sh --batch-id 001` | Generate batch + wait for suggestions |
| `bash scripts/triage_run.sh --batch-id 001 --apply` | Apply patch after getting suggestions |
| `bash scripts/triage_run.sh --batch-id 001 --indexed` | ID-proof workflow |
| `bash scripts/triage_apply_patch.sh <patch> --dry-run` | Test patch without applying |
| `node scripts/validate_jsonl.mjs <file>` | Validate JSONL suggestions |
| `cat thread-vault/patches/*.report.json` | View patch reports |

---

**Implementation Date:** 2026-01-03  
**Status:** Complete and Verified  
**Documentation:** RUNBOOK_TRIAGE.md
