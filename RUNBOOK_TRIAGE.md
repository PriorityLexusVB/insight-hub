# Triage Loop Runbook — Hardened Workflow

This document describes the **deterministic, guardrailed triage loop** for handling unknown/low-confidence threads in Insight Hub.

---

## Overview

The triage loop processes threads with `domain: unknown` or low router confidence through an LLM to suggest proper classifications. The loop includes:

1. **Batch generation** — Create a queue of threads to triage
2. **LLM suggestions** — Get classification suggestions from an LLM
3. **Patch generation** — Create a safe, auditable patch
4. **Patch application** — Apply changes with 3-way merge
5. **Verification** — Re-run analysis and confirm triage_count delta

**Guardrails ensure:**
- Suggestions match queue IDs (no invented thread_uid)
- Patches are never empty (0-byte protection)
- Patches have stable, batch-numbered names
- All steps are repeatable and auditable

---

## Quick Start (Standard Workflow)

### One-command triage run:

```bash
# Generate batch + wait for suggestions
bash scripts/triage_run.sh --batch-id 001 --limit 150 --threshold 0.75
# ... follow prompts to get LLM suggestions ...

# After you have suggestions, apply patch
bash scripts/triage_run.sh --batch-id 001 --apply
```

That's it! The script handles everything with built-in guardrails.

---

## Detailed Workflow

### Step 1: Generate Triage Batch

```bash
node scripts/triage_unknowns_make_batch.mjs \
  --in analytics/_current/chat_index.json \
  --threads thread-vault/threads \
  --out analytics/_current/triage \
  --limit 150 \
  --unknownOnly \
  --batchId 001
```

**Outputs:**
- `analytics/_current/triage/unknown_queue_001.json` (queue with thread_uid)
- `analytics/_current/triage/triage_batch_001.md` (formatted for LLM)

**What it does:**
- Selects threads with `domain: unknown` or low confidence
- Sorts by `load_score` (most important first)
- Creates structured markdown with JSONL contract

### Step 2: Get LLM Suggestions

1. Open `triage_batch_001.md`
2. Paste entire file into ChatGPT/Claude/Gemini
3. Request JSONL output (the file contains the exact contract)
4. Save LLM response to: `analytics/_current/triage/triage_suggestions_001.jsonl`

**Validate suggestions:**

```bash
node scripts/validate_jsonl.mjs analytics/_current/triage/triage_suggestions_001.jsonl
```

### Step 3: Generate Safe Patch (with Guardrails)

```bash
node scripts/triage_unknowns_make_patch.mjs \
  --suggestions analytics/_current/triage/triage_suggestions_001.jsonl \
  --queue analytics/_current/triage/unknown_queue_001.json \
  --threads thread-vault/threads \
  --minConfidence 0.75
```

**Automatic behaviors:**
- Patch filename: `thread-vault/patches/route_suggestions_001_075.safe.patch`
- Report file: `thread-vault/patches/route_suggestions_001_075.safe.report.json`

**Guardrails (will fail if):**
- ❌ No suggestions match queue IDs (ok_matches = 0)
- ❌ Patch is empty (0 bytes)
- ✅ Use `--force` to bypass guardrails (only if you know what you're doing)

**Check the report:**

```bash
cat thread-vault/patches/route_suggestions_001_075.safe.report.json
```

Example output:
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

### Step 4: Apply Patch (Safe with 3-way Merge)

```bash
# Dry-run first (recommended)
bash scripts/triage_apply_patch.sh thread-vault/patches/route_suggestions_001_075.safe.patch --dry-run

# Apply for real
bash scripts/triage_apply_patch.sh thread-vault/patches/route_suggestions_001_075.safe.patch
```

**What it does:**
1. Creates branch `triage-apply-001`
2. Runs `git apply --check` first
3. Applies with `--recount --3way` for conflict resolution
4. Detects reject files if conflicts occur
5. Shows clear next steps

**If successful:**
```bash
git diff  # review changes
git add .
git commit -m "Apply triage batch 001 (75% threshold)"
git checkout main  # or your original branch
git merge triage-apply-001
git branch -d triage-apply-001
```

### Step 5: Verify Results

```bash
# Re-run analysis
pnpm -C apps/indexer-cli start -- analyze --out analytics/_current --emit-rollup --emit-html

# Check triage_count delta
node -e "const r=require('./analytics/_current/chat_index.json'); console.log('unknown:', r.filter(x=>x.domain==='unknown').length);"
```

---

## ID-Proof Workflow (Indexed Mode)

**Use this if the LLM keeps inventing thread_uid values.**

This workflow uses `batch_index` (1, 2, 3...) instead of `thread_uid`, then maps back after LLM response.

### Step 1: Generate Indexed Batch

```bash
bash scripts/triage_run.sh --batch-id 001 --indexed
```

This creates:
- `unknown_queue_001_indexed.json`
- `triage_batch_001_indexed.md` (with batch_index instead of thread_uid)
- `batch_index_map_001.json` (mapping file)

### Step 2: Get LLM Suggestions (Indexed)

1. Open `triage_batch_001_indexed.md`
2. Paste into LLM
3. LLM returns JSONL with `batch_index` (not thread_uid)
4. Save to: `triage_suggestions_001_indexed.jsonl`

### Step 3: Merge Back to thread_uid

```bash
node scripts/triage_merge_indexed_suggestions.mjs \
  --suggestions analytics/_current/triage/triage_suggestions_001_indexed.jsonl \
  --map analytics/_current/triage/batch_index_map_001.json \
  --out analytics/_current/triage/triage_suggestions_001.jsonl
```

### Step 4: Continue with Standard Workflow

Now you have a proper `triage_suggestions_001.jsonl` with `thread_uid`. Continue from Step 3 of the standard workflow.

---

## Confidence Thresholds

Choose based on risk tolerance:

| Threshold | Use Case | Risk |
|-----------|----------|------|
| **0.60** | Final sweep, small batches | Higher — more LLM errors |
| **0.70** | Default, balanced | Medium — occasional errors |
| **0.75** | Conservative, safe | Low — high confidence only |
| **0.80** | Very conservative | Very low — only obvious ones |

**Recommendation:** Start with 0.75, then do a 0.70 pass, then a careful 0.60 final sweep.

---

## Troubleshooting

### Guardrail Failure: ok_matches = 0

**Problem:** Suggestions don't match any queue IDs.

**Causes:**
- LLM invented thread_uid values
- Wrong queue file
- Suggestions from different batch

**Solutions:**
1. Use indexed mode: `bash scripts/triage_run.sh --batch-id 001 --indexed`
2. Regenerate batch and suggestions
3. Manually inspect suggestions file: check if thread_uid values are valid

### Guardrail Failure: Empty Patch (0 bytes)

**Problem:** No changes detected.

**Causes:**
- All suggestions already applied (idempotent check)
- Confidence threshold too high
- Suggestions don't match existing threads

**Solutions:**
1. Lower threshold: `--threshold 0.70` or `0.60`
2. Check if triage already complete: run analysis and check triage_count
3. Inspect suggestions: `node scripts/validate_jsonl.mjs <file>`

### Patch Application Failed

**Problem:** `git apply` reports conflicts.

**Causes:**
- Files modified since patch generated
- Patch from different branch
- Concurrent edits

**Solutions:**
1. Check git status: `git status`
2. Regenerate patch from current branch
3. Resolve conflicts manually using reject files
4. Review changes: `git diff`

### Triage Count Didn't Change

**Expected behavior if:**
- Patch was idempotent (already applied)
- All suggestions were below confidence threshold
- Suggestions only changed metadata (apps/tags), not domain

**Verify:**
```bash
# Check what actually changed
git diff --stat

# Check domain distribution
node -e "const r=require('./analytics/_current/chat_index.json'); const c=r.reduce((a,x)=>(a[x.domain]=(a[x.domain]||0)+1,a),{}); console.log(c);"
```

---

## Weekly Triage Workflow

**Recommended cadence:** Weekly or bi-weekly

```bash
# 1. Rebuild analytics
pnpm -C apps/indexer-cli start -- analyze --out analytics/_current --emit-rollup --emit-html

# 2. Check triage count
node -e "const r=require('./analytics/_current/chat_index.json'); console.log('unknown:', r.filter(x=>x.domain==='unknown').length);"

# 3. If > 50 unknowns, run triage
bash scripts/triage_run.sh --batch-id 002 --limit 150 --threshold 0.75

# 4. Get LLM suggestions (manual step)
# ... paste triage_batch_002.md into LLM ...
# ... save output to triage_suggestions_002.jsonl ...

# 5. Apply patch
bash scripts/triage_run.sh --batch-id 002 --apply

# 6. Commit results
git add analytics/_current/ thread-vault/threads/
git commit -m "Triage batch 002: $(git diff --stat | tail -1)"
git push
```

---

## Safety & Rollback

### Before Triage
```bash
# Create safety checkpoint
git tag triage-before-002 -m "Before triage batch 002"
```

### Rollback if Needed
```bash
# Soft rollback (keep changes, undo commit)
git reset --soft HEAD~1

# Hard rollback (discard all changes)
git reset --hard triage-before-002

# Nuclear option (restore from backup)
git checkout HEAD~1 -- thread-vault/threads/
```

---

## Audit Trail

All triage operations are auditable:

```bash
# View patch history
ls -lt thread-vault/patches/*.patch

# View patch reports
cat thread-vault/patches/route_suggestions_001_075.safe.report.json

# View git history for specific thread
git log --follow thread-vault/threads/THREAD-12345.md

# View all triage commits
git log --grep="triage batch" --oneline
```

---

## Integration with NotebookLM

Triage artifacts can be added as temporary sources to NotebookLM:

```bash
# Refresh NotebookLM bundles after triage
bash scripts/notebooklm_refresh.sh
```

Optionally include triage batch files in NotebookLM:
- `analytics/_current/triage/triage_batch_*.md` (input)
- `thread-vault/patches/*.report.json` (results)

---

## Command Reference

### Batch Generation
```bash
node scripts/triage_unknowns_make_batch.mjs \
  --in analytics/_current/chat_index.json \
  --threads thread-vault/threads \
  --out analytics/_current/triage \
  --limit 150 \
  --unknownOnly \
  --batchId 001
```

### Indexed Batch (ID-Proof)
```bash
node scripts/triage_index_batch.mjs \
  --queue analytics/_current/triage/unknown_queue_001.json \
  --out analytics/_current/triage/unknown_queue_001_indexed.json \
  --map analytics/_current/triage/batch_index_map_001.json \
  --batch analytics/_current/triage/triage_batch_001_indexed.md
```

### Merge Indexed Suggestions
```bash
node scripts/triage_merge_indexed_suggestions.mjs \
  --suggestions analytics/_current/triage/triage_suggestions_001_indexed.jsonl \
  --map analytics/_current/triage/batch_index_map_001.json \
  --out analytics/_current/triage/triage_suggestions_001.jsonl
```

### Patch Generation (with Guardrails)
```bash
node scripts/triage_unknowns_make_patch.mjs \
  --suggestions analytics/_current/triage/triage_suggestions_001.jsonl \
  --queue analytics/_current/triage/unknown_queue_001.json \
  --threads thread-vault/threads \
  --minConfidence 0.75
```

### Patch Application
```bash
bash scripts/triage_apply_patch.sh thread-vault/patches/route_suggestions_001_075.safe.patch [--dry-run]
```

### End-to-End Run
```bash
bash scripts/triage_run.sh \
  [--batch-id 001] \
  [--limit 150] \
  [--threshold 0.75] \
  [--dry-run | --apply] \
  [--indexed]
```

---

## Related Documentation

- [Main Runbook](./RUNBOOK.md) — Overall dashboard + pipeline workflow
- [NotebookLM Runbook](./RUNBOOK_NOTEBOOKLM.md) — NotebookLM integration
- [Data Dictionary](./analytics/_current/data_dictionary.md) — Field definitions

---

**Last Updated:** 2026-01-03
