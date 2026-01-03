# NotebookLM Bundle — Insight Hub — Repo Packets
Generated: 2026-01-03T00:54:14.706Z

## Included sources
- notebooklm_packets/packets/repo/analytics_data_dictionary_snapshot.md
- notebooklm_packets/packets/repo/handoff_snapshot.md
- notebooklm_packets/packets/repo/readme_snapshot.md
- notebooklm_packets/packets/repo/repo_overview.md
- notebooklm_packets/packets/repo/runbook_snapshot.md
- notebooklm_packets/packets/repo/work_summary_snapshot.md

---



---

# SOURCE: analytics_data_dictionary_snapshot.md

# Analytics Data Dictionary Snapshot

# Chat Index Data Dictionary

This describes the columns produced by `analyze` in `chat_index.csv` / `chat_index.json`.

## Output files

- `chat_index.json`: full row data (recommended for drill-down)
- `chat_index.csv`: stable CSV contract for spreadsheets
- `work_only.csv`: work-focused subset CSV
- `work_summary.md`: work counts + top lists
- `leadership_vs_builder.md`: cohort averages
- `leverage_audit.md`: top 15 SOP candidates + best systems

## Columns

- `thread_uid`: Thread identifier (from front matter; falls back to filename)
- `title`: Thread title (from front matter)
- `domain`: Domain label from routing metadata (front matter)
- `apps`: List of app names (front matter). In CSV this is a JSON string.
- `tags`: List of tags (front matter). In CSV this is a JSON string.
- `primary_home_file`: Router primary home file path (front matter)
- `primary_home_section`: Router primary home section (front matter)
- `router_confidence`: Router confidence (number; nullable)
- `cluster_id`: Merge cluster id (front matter; may be empty)
- `word_count`: Word count of body text with fenced code blocks removed
- `emdash_count`: Count of em-dash characters (—) in body text
- `constraint_count`: Count of constraint phrases matched in body text
- `CDI`: Constraint Density Index
- `turns_total`: Total messages from raw conversation export if found (nullable)
- `user_turns`: User messages from raw export if found (nullable)
- `assistant_turns`: Assistant messages from raw export if found (nullable)
- `cwid`: Cognitive Workload Index Density (nullable)
- `cwid_is_proxy`: `true` when `cwid` uses a timestamp-based proxy turns estimate
- `maturity_score`: System maturity score (0–100)
- `load_score`: Cognitive load score (continuous)
- `is_work`: Work classification boolean
- `work_type`: Work category label (ops/technical/comms/etc.)

## Key formulas

- CDI: `((emdash_count + constraint_count) / max(1, word_count)) * 1000`
- CWID: `turns * CDI`, where `turns = turns_total` if raw exports match; otherwise proxy turns from timestamps
- Load: `word_count * (1 + CDI/1000) * (1 + turns/50)` where `turns = turns_total ?? approx_turns ?? 0`

## Proxy turns

When raw conversation exports are not available/matchable, turns are approximated from `created_at` and `last_active_at` as `approx_turns = clamp(round(minutes/2), 2, 60)`. In that case `turns_total/user_turns/assistant_turns` remain blank/null and `cwid_is_proxy=true`.



---

# SOURCE: handoff_snapshot.md

# HANDOFF Snapshot

# InsightHub Handoff — 2025-12-30

This is a quick checkpoint of what we implemented and where the workflow stands, so you can pick it up at home.

## Repo + context

- Repo: `PriorityLexusVB/insight-hub` (branch: `master`)
- OS: Linux (WSL), workspace root:
  - `/mnt/c/Users/ROB.BRASCO/GITHUB_ON_C/insight-hub`

## Goal

Fix routing/classification so **low-confidence router output** doesn’t force everything into `dealership_ops` / `ops`, then run a **triage loop** to clean up remaining `unknown` / low-confidence rows using an LLM-generated JSONL → patch workflow.

## What changed (code)

### 1) Router confidence gate (prevents “ops swallowing everything”)

File: `apps/indexer-cli/src/commands/analyzeCommand.ts`

In `runAnalyzeCommand`:

- Added a confidence gate:
  - `ROUTER_MIN_CONF = 0.7`
  - `lowConf = routerConfidence !== null && routerConfidence < ROUTER_MIN_CONF`
- If `lowConf`:
  - `domainEffective = "unknown"`
  - `primaryHomeFileEffective = ""`
- Classification uses **sanitized meta** so low-confidence routing doesn’t force `ops`:
  - `metaForClassify.domain = ""`
  - removes `metaForClassify.router.primary_home`
- Emitted rows now use:
  - `domain: domainEffective`
  - `primary_home_file: primaryHomeFileEffective`

### 2) Better fallback classifier for unknowns

File: `apps/indexer-cli/src/commands/analyzeCommand.ts`

Replaced `fallbackClassifyUnknown()` with the new higher-precedence rules:

- Research / claims / evidence / stats has highest precedence → `research/unknown`
- Infra / tech support → `infra_agents/technical`
- Docs/spreadsheets/office workflows → `infra_agents/technical` (or `infra_agents/comms` for “Articles of Organization”)
- Creative / design / media → `infra_agents/creative`
- Personal / home / DIY → `personal/personal`
- Dealership / Lexus at the end → `dealership_ops/ops`

## What changed (VS Code)

Created VS Code tasks file:

- `.vscode/tasks.json`

Tasks:

- `InsightHub: Analyze (_current)`
- `InsightHub: Build Message Index 2025 (_current)`
- `InsightHub: Rebuild ALL (_current)`

## New scripts (triage loop)

### A) Make triage batch

File: `scripts/triage_unknowns_make_batch.mjs`

Purpose:

- Reads `analytics/_current/chat_index.json`
- Selects top `unknown` domain rows and/or low router confidence rows
- Writes:
  - `analytics/_current/triage/unknown_queue.json`
  - `analytics/_current/triage/triage_batch_001.md`

### B) Make diff-only patch from LLM suggestions

File: `scripts/triage_unknowns_make_patch.mjs`

Purpose:

- Takes JSONL (`triage_suggestions.jsonl`)
- Generates a unified diff patch without directly editing repo files
- Output default:
  - `thread-vault/patches/route_suggestions.patch`

## Outputs generated (latest)

- Analysis outputs written to:

  - `analytics/_current/`
  - Includes `chat_index.json`, `chat_index.csv`, `index.html`, and `rollup/`

- Triage batch generated:

  - `analytics/_current/triage/triage_batch_001.md`
  - `analytics/_current/triage/unknown_queue.json`
  - Count was `200` in the last run.

- You also zipped the report for portability:
  - `analytics/_current` → `insight_current_report.zip` (on Desktop)

## Where we are in the process

DONE:

1. Confidence gate + sanitized meta classification
2. Updated fallback unknown classifier
3. Rebuilt CLI and re-ran analyze at least once
4. Added triage scripts
5. Generated triage batch markdown + queue JSON

NEXT (finish at home):

1. Feed `triage_batch_001.md` to your “smart thing” and get JSONL back
2. Save JSONL to `analytics/_current/triage/triage_suggestions.jsonl`
3. Generate patch and apply safely
4. Re-run analyze to refresh HTML

## Exact commands to finish at home

From repo root:

### 1) (Optional) re-run analyze first

```bash
pnpm -C apps/indexer-cli build
node apps/indexer-cli/dist/index.js analyze --out analytics/_current --emit-rollup --emit-html
```

### 2) Re-generate triage batch (if you want fresh)

```bash
node scripts/triage_unknowns_make_batch.mjs \
  --in analytics/_current/chat_index.json \
  --threads thread-vault/threads \
  --out analytics/_current/triage \
  --limit 200
```

Open the batch file:

```bash
code analytics/_current/triage/triage_batch_001.md
```

### 3) Run LLM and save JSONL

Instruction for the LLM:

- “Return JSONL exactly per contract at top of file.”

Save output to:

- `analytics/_current/triage/triage_suggestions.jsonl`

### 4) Generate patch (diff-only), check, apply

```bash
node scripts/triage_unknowns_make_patch.mjs \
  --suggestions analytics/_current/triage/triage_suggestions.jsonl \
  --threads thread-vault/threads \
  --outPatch thread-vault/patches/route_suggestions.patch \
  --minConfidence 0.75

# check patch
git apply --check thread-vault/patches/route_suggestions.patch

# apply patch
git apply thread-vault/patches/route_suggestions.patch
```

### 5) Re-run analyze to refresh HTML

```bash
pnpm -C apps/indexer-cli build
node apps/indexer-cli/dist/index.js analyze --out analytics/_current --emit-rollup --emit-html
```

## Notes / guardrails

- The confidence gate is intentionally conservative: when router confidence is below 0.7, routing is treated as unknown for domain/home/work_type classification inputs.
- The patch generator only applies suggestions with `confidence >= --minConfidence` (default 0.75), so you don’t accidentally apply low-confidence changes.
- The patch generator writes minimal YAML-ish frontmatter fields into the thread markdown (safe + reversible).



---

# SOURCE: readme_snapshot.md

# README Snapshot

# Insight Hub / Conversation Indexer

Local-first tool to import ChatGPT export data, summarize/categorize threads, de-dupe clusters, and generate reviewable outputs (thread cards + inbox + patches).

## Indexer CLI Runbook

Build:

```
pnpm -C apps/indexer-cli build
```

Run the full pipeline (import → summarize → route → merge → enrich-clusters → inbox):

```
pnpm -C apps/indexer-cli start -- run <zipPath> --mode heuristic
```

Generate analytics (read-only; writes to analytics/ only):

```
pnpm -C apps/indexer-cli start -- analyze
pnpm -C apps/indexer-cli start -- analyze --out analytics/_dev --work-only
pnpm -C apps/indexer-cli start -- analyze --out analytics/_dev --emit-html
pnpm -C apps/indexer-cli start -- analyze --out analytics/_dev --emit-rollup
```

Notes:

- `thread-vault/` is the source of truth for thread cards (`thread-vault/threads/*.md`).
- `docs/` is the curated knowledge base the router targets.
- `analytics/` is always generated output (metrics + optional dashboard). By default, `analyze` writes to `analytics/<timestamp>/`.
- `--out` is resolved relative to the repo root (absolute paths also work).

Open the dashboard:

- WSL: `wslview analytics/_dev/index.html`
- Windows Explorer: `explorer.exe "$(wslpath -w analytics/_dev/index.html)"`

Organization map: `thread-vault/` is source memory (thread cards), `docs/` is curated knowledge (router destinations), and `analytics/` is generated metrics + a local HTML dashboard view of the analytics outputs.



---

# SOURCE: repo_overview.md

# Insight Hub Repo Overview

Generated: 2026-01-03T00:54:14.214Z

This packet set is built for NotebookLM ingestion.

Key generated outputs:
- analytics/_current/chat_index.json
- analytics/_current/chat_index.csv
- analytics/_current/index.html
- analytics/_current/data_dictionary.md
- analytics/_current/work_summary.md



---

# SOURCE: runbook_snapshot.md

# RUNBOOK Snapshot

# Insight Hub — Runbook (Deterministic Workflow)

This repo produces a single “always-current” analytics dashboard + rollups, plus an optional LLM-assisted triage loop for the remaining unknowns.

---

## Where the outputs live

### Always-current dashboard

- `analytics/_current/index.html`
- Data:
  - `analytics/_current/chat_index.json`
  - `analytics/_current/chat_index.csv`
- Rollups:
  - `analytics/_current/rollup/rollup.md`
  - `analytics/_current/rollup/collisions.md`
  - `analytics/_current/rollup/rollup.json`
  - `analytics/_current/rollup/dedupe_report.json`

### Triage artifacts (inputs/outputs)

- `analytics/_current/triage/triage_batch_<ID>.md`
- `analytics/_current/triage/triage_suggestions_<ID>.jsonl`
- `analytics/_current/triage/unknown_queue_<ID>.json`

### Patches (safe + auditable)

- `thread-vault/patches/route_suggestions_<ID>_<THRESH>.safe.patch`

> Note: `thread-vault/` is git-ignored. Changes won’t show in `git status`.

---

## Primary commands

### Rebuild dashboard + rollups (always)

````bash
node apps/indexer-cli/dist/index.js analyze --out analytics/_current --emit-rollup --emit-html
Zip the report bundle for home (Google Drive)
bash
Copy code
zip -r /mnt/c/Users/ROB.BRASCO/Desktop/insight_current_report.zip analytics/_current
ls -lh /mnt/c/Users/ROB.BRASCO/Desktop/insight_current_report.zip
Full pipeline restore (rebuild thread-vault from export)
Mount H: (if needed):

bash
Copy code
sudo mkdir -p /mnt/h
sudo mount -t drvfs H: /mnt/h
Run pipeline:

bash
Copy code
export NODE_OPTIONS="--max-old-space-size=8192"
ZIP="/mnt/h/Rob/Downloads/<YOUR_EXPORT>.zip"
node apps/indexer-cli/dist/index.js run "$ZIP"
LLM triage loop (only for remaining unknowns)
1) Generate a triage batch
bash
Copy code
node scripts/triage_unknowns_make_batch.mjs \
  --in analytics/_current/chat_index.json \
  --threads thread-vault/threads \
  --out analytics/_current/triage \
  --limit 200 \
  --unknownOnly \
  --batchId 010
This creates:

analytics/_current/triage/triage_batch_010.md

analytics/_current/triage/unknown_queue_010.json

2) Get model output (JSONL)
Open triage_batch_010.md, paste into ChatGPT/Claude/Gemini with the strict JSONL contract.
Save the output to:

analytics/_current/triage/triage_suggestions_010.jsonl

Validate:

bash
Copy code
node scripts/validate_jsonl.mjs analytics/_current/triage/triage_suggestions_010.jsonl
3) Build a YAML-preserving patch (safe + idempotent)
bash
Copy code
node scripts/triage_unknowns_make_patch.mjs \
  --suggestions analytics/_current/triage/triage_suggestions_010.jsonl \
  --threads thread-vault/threads \
  --outPatch thread-vault/patches/route_suggestions_010_070.safe.patch \
  --minConfidence 0.70
If patch is non-empty:

bash
Copy code
git apply --check thread-vault/patches/route_suggestions_010_070.safe.patch
git apply thread-vault/patches/route_suggestions_010_070.safe.patch
4) Rebuild dashboard
bash
Copy code
node apps/indexer-cli/dist/index.js analyze --out analytics/_current --emit-rollup --emit-html
Notes / Safety
The patcher preserves YAML front matter (title/created_at/router/merge/etc).

It is idempotent: it will NOT generate diffs for reason/timestamp-only changes.

Apply thresholds:

Default: 0.70

Conservative: 0.75

Final sweep only: 0.60 (small batches)

Quick health checks
Unknown count
bash
Copy code
node -e "const r=require('./analytics/_current/chat_index.json'); const total=r.length; const unk=r.filter(x=>x.domain==='unknown').length; console.log({unknown:unk,total,unknown_pct:(unk/total*100).toFixed(1)+'%'});"
Domain distribution
bash
Copy code
node -e "const r=require('./analytics/_current/chat_index.json'); const c=(k)=>Object.entries(r.reduce((a,x)=>(a[x[k]||'']=(a[x[k]||'']||0)+1,a),{})).sort((a,b)=>b[1]-a[1]).slice(0,12); console.log('domains:',c('domain')); console.log('work_type:',c('work_type'));"
Home access (Google Drive workflow)
Upload C:\Users\ROB.BRASCO\Desktop\insight_current_report.zip to Google Drive.

Download at home and unzip.

Open: ...\analytics\_current\index.html

bash
Copy code

### Save it
Then commit/push:

```bash
cd /mnt/c/Users/ROB.BRASCO/GITHUB_ON_C/insight-hub
git add RUNBOOK.md
git commit -m "docs: add Insight Hub runbook"
git push
````



---

# SOURCE: work_summary_snapshot.md

# Work Summary Snapshot

# Work Summary

Total threads: 1261
Work threads (is_work): 1193
Work-only threads: 1193

## Top 10 CWID

- 68b30916-81c4-8333-9740-fc858089367c — Branded query drop analysis (CWID=9570.55)
- 6876c493-73a0-8005-9708-dfbc0380b10c — Conversation Summary Request (CWID=3380.28)
- 69056137-aef0-8327-9049-9d288ce45b77 — Riddles for Carmine (CWID=3370.79)
- 6946681e-806c-832e-b490-7764674d61e3 — Build a Fortellis Async Sandbox (CWID=3272.73)
- 68a602bd-a8a4-8321-adb2-e5c703e3cded — Priority Lead Sync Handoff (CWID=3260.87)
- 693e6228-bc90-832f-b361-843db2cf4166 — Test a Full Multi‑Agent PR Cycle (CWID=3103.45)
- 686c1c4b-7424-8005-b448-7ddad6d07cb7 — Manual Input and Date (CWID=3061.22)
- 68dd8944-14c4-8322-b9d8-82c3ca35a2f8 — Paint vs spray paint (CWID=2803.74)
- 6882f4de-1858-832a-972c-c5f44b0534eb — Fish pain evidence inquiry (CWID=2790.70)
- 693c8ee1-71c0-8328-bc61-da1e76a9c227 — Logo creation request (CWID=2727.27)

## Top 10 Cognitive Load

- 672d894a-0a24-8005-a3b7-f96360f8abb9 — Bio Improvement (Load=842.60)
- 6933041f-1480-8327-8d0e-ba2763e9456f — Debugging Supabase Errors (Load=833.80)
- e3ca8f0d-0308-40bf-b416-c5cabfa0beb7 — Lexus Sales Strategy Discussion (Load=785.40)
- 68ed8893-5a48-832b-89e3-14da8ecfe06a — Can you hear me (Load=752.40)
- d7cf2dd1-b9b7-40cd-a6d2-58d76ae7ed0a — Vehicle Trade-In Service Process (Load=743.60)
- ff9774a7-113d-4d08-9f8a-30382cacb6ed — Loving Dad, Three Kids. (Load=739.20)
- 692cfd45-14e4-8330-b675-c27f698772c3 — Liquidation pallet reselling (Load=704.00)
- 6924e169-fbe8-832e-911c-d4c45200603d — Supabase RLS debugging (Load=704.00)
- 4d992afd-af97-4217-a3a6-7ca8470e3eea — Interrogatories: Answering Effectively. (Load=682.00)
- 68ea9189-769c-832e-ad99-21be001d8fb9 — Google AI Studio secrets (Load=673.20)

## Top 10 System Maturity

- 68ea89d7-1d54-8332-97b3-07d5aac72ad1 — Scheduling flow description (Maturity=50.00)
- 68e93779-1e50-8322-9738-b3609caa7792 — Fix customer display issue (Maturity=45.00)
- 69152d8d-01e0-8328-b004-4ea272ffb0d1 — Summarize app files (Maturity=45.00)
- 68e1dc11-7ab4-832a-ba71-ede820ea5510 — Aftermarket tracker build (Maturity=40.00)
- 05cd5fe7-638a-4eed-884c-169b61d66435 — OpenAI ChatGPT API (Maturity=35.00)
- 26a74245-b97e-4238-85bf-f00a6f58559b — Futuristic Memory Thriller (Maturity=35.00)
- 6777352c-e128-8005-a83f-a0bc5d15a2d5 — Mr. Kornegay 1930s Desk (Maturity=35.00)
- 677f0370-fcd4-8005-af9b-ef34d9633fcc — Reunification Therapy Checklist (Maturity=35.00)
- 680920b7-c10c-8005-990d-9c85497dbdc3 — Automotive Service Taxation (Maturity=35.00)
- 680d8aa8-43e0-8005-9665-e63df6ee1516 — Garage Organization Help (Maturity=35.00)
