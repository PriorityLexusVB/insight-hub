# Triage Loop Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    INSIGHT HUB TRIAGE LOOP                      │
│                    (Hardened & Guardrailed)                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: GENERATE BATCH                                          │
│                                                                  │
│  $ bash scripts/triage_run.sh --batch-id 001                    │
│                                                                  │
│  Input:  analytics/_current/chat_index.json                     │
│  Output: analytics/_current/triage/unknown_queue_001.json       │
│          analytics/_current/triage/triage_batch_001.md          │
│                                                                  │
│  ✓ Filters threads with domain=unknown or low confidence        │
│  ✓ Sorts by load_score (most important first)                   │
│  ✓ Creates structured markdown with JSONL contract              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: GET LLM SUGGESTIONS (Manual)                            │
│                                                                  │
│  1. Open: triage_batch_001.md                                   │
│  2. Paste into ChatGPT/Claude/Gemini                            │
│  3. Request JSONL output (contract is in the file)              │
│  4. Save to: triage_suggestions_001.jsonl                       │
│                                                                  │
│  ⚠️  Common Issue: LLM invents thread_uid values                │
│      Solution: Use indexed mode (see alternative flow below)    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: VALIDATE SUGGESTIONS                                    │
│                                                                  │
│  $ node scripts/validate_jsonl.mjs \                            │
│      analytics/_current/triage/triage_suggestions_001.jsonl     │
│                                                                  │
│  ✓ Checks JSONL syntax                                          │
│  ✓ Validates first 3 entries                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: GENERATE PATCH (with Guardrails)                        │
│                                                                  │
│  Auto-run by triage_run.sh or manually:                         │
│  $ node scripts/triage_unknowns_make_patch.mjs \                │
│      --suggestions triage_suggestions_001.jsonl \               │
│      --queue unknown_queue_001.json \                           │
│      --minConfidence 0.75                                       │
│                                                                  │
│  Guardrails:                                                     │
│  ✓ GUARDRAIL 1: Validates ok_matches > 0 (IDs must match)       │
│  ✓ GUARDRAIL 2: Refuses 0-byte patches                          │
│  ✓ GUARDRAIL 3: Stable naming with batch ID                     │
│  ✓ GUARDRAIL 4: Writes patch report JSON                        │
│                                                                  │
│  Output: thread-vault/patches/route_suggestions_001_075.safe.patch│
│          thread-vault/patches/route_suggestions_001_075.safe.report.json│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: REVIEW PATCH REPORT                                     │
│                                                                  │
│  $ cat thread-vault/patches/*.report.json                       │
│                                                                  │
│  {                                                               │
│    "timestamp": "2026-01-03T04:15:00.000Z",                     │
│    "batch_id": "001",                                            │
│    "suggestions_lines": 45,                                      │
│    "ok_matches": 45,          ← All IDs matched! ✓              │
│    "files_changed": 42,                                          │
│    "patch_bytes": 18432       ← Non-zero patch ✓                │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: APPLY PATCH                                             │
│                                                                  │
│  $ bash scripts/triage_run.sh --batch-id 001 --apply            │
│                                                                  │
│  OR manually:                                                    │
│  $ bash scripts/triage_apply_patch.sh \                         │
│      thread-vault/patches/route_suggestions_001_075.safe.patch  │
│                                                                  │
│  Process:                                                        │
│  ✓ Creates branch: triage-apply-001                             │
│  ✓ Runs git apply --check first (dry-run)                       │
│  ✓ Applies with --recount --3way (handles conflicts)            │
│  ✓ Detects reject files if any                                  │
│  ✓ Shows clear next steps                                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 7: VERIFY & COMMIT                                         │
│                                                                  │
│  $ git diff                                                      │
│  $ git add thread-vault/threads/                                │
│  $ git commit -m "Apply triage batch 001"                       │
│  $ git checkout main && git merge triage-apply-001              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 8: RE-RUN ANALYSIS                                         │
│                                                                  │
│  $ pnpm -C apps/indexer-cli start -- \                          │
│      analyze --out analytics/_current --emit-rollup --emit-html │
│                                                                  │
│  $ node -e "const r=require('./analytics/_current/chat_index.json'); \
│      console.log('unknown:', r.filter(x=>x.domain==='unknown').length);"│
│                                                                  │
│  Before: 150 unknowns                                            │
│  After:  108 unknowns                                            │
│  Delta:  -42 ✓                                                   │
└─────────────────────────────────────────────────────────────────┘


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ ALTERNATIVE: ID-PROOF WORKFLOW (Indexed Mode)                  ┃
┃ Use when LLM invents thread_uid values                         ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: GENERATE INDEXED BATCH                                  │
│                                                                  │
│  $ bash scripts/triage_run.sh --batch-id 001 --indexed          │
│                                                                  │
│  Output: unknown_queue_001_indexed.json                         │
│          triage_batch_001_indexed.md  ← Uses batch_index       │
│          batch_index_map_001.json     ← Mapping file           │
│                                                                  │
│  Batch now contains:                                             │
│    batch_index: 1, 2, 3... (instead of thread_uid)             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: GET LLM SUGGESTIONS (Indexed)                           │
│                                                                  │
│  1. Open: triage_batch_001_indexed.md                           │
│  2. Paste into LLM                                               │
│  3. LLM returns JSONL with batch_index (not thread_uid)         │
│  4. Save to: triage_suggestions_001_indexed.jsonl               │
│                                                                  │
│  Example output:                                                 │
│    {"batch_index":1,"domain":"dealership_ops",...}              │
│    {"batch_index":2,"domain":"infra_agents",...}                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: MERGE BACK TO THREAD_UID                                │
│                                                                  │
│  $ node scripts/triage_merge_indexed_suggestions.mjs \          │
│      --suggestions triage_suggestions_001_indexed.jsonl \       │
│      --map batch_index_map_001.json \                           │
│      --out triage_suggestions_001.jsonl                         │
│                                                                  │
│  ✓ Maps batch_index → thread_uid                                │
│  ✓ Creates proper suggestions file                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
            Continue with STEP 4 of standard workflow


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ GUARDRAILS PREVENT COMMON FAILURES                             ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

❌ BLOCKED: LLM invented thread_uid
   → ok_matches = 0
   → Script refuses to continue
   → Solution: Use indexed mode

❌ BLOCKED: Empty patch (0 bytes)
   → No changes detected
   → Script refuses to write
   → Solution: Lower threshold or check if already applied

❌ BLOCKED: Patch conflicts
   → git apply --check failed
   → Script shows reject files
   → Solution: Resolve conflicts manually or regenerate patch

✅ ALLOWED: Valid patch with matched IDs
   → ok_matches > 0
   → patch_bytes > 0
   → Proceeds to application


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ COMMAND QUICK REFERENCE                                         ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

One-command run:
  bash scripts/triage_run.sh --batch-id 001

With apply:
  bash scripts/triage_run.sh --batch-id 001 --apply

Indexed mode:
  bash scripts/triage_run.sh --batch-id 001 --indexed

Dry-run only:
  bash scripts/triage_run.sh --batch-id 001 --dry-run

Manual patch:
  bash scripts/triage_apply_patch.sh <patch_file> --dry-run
  bash scripts/triage_apply_patch.sh <patch_file>

Check triage count:
  node -e "const r=require('./analytics/_current/chat_index.json'); \
    console.log('unknown:', r.filter(x=>x.domain==='unknown').length);"


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ FILES CREATED BY WORKFLOW                                       ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

analytics/_current/triage/
  ├── unknown_queue_001.json              (queue with thread_uid)
  ├── triage_batch_001.md                 (LLM input)
  ├── triage_suggestions_001.jsonl        (LLM output)
  ├── unknown_queue_001_indexed.json      (indexed queue)
  ├── triage_batch_001_indexed.md         (indexed LLM input)
  ├── triage_suggestions_001_indexed.jsonl (indexed LLM output)
  └── batch_index_map_001.json            (mapping file)

thread-vault/patches/
  ├── route_suggestions_001_075.safe.patch       (actual patch)
  └── route_suggestions_001_075.safe.report.json (metadata report)
