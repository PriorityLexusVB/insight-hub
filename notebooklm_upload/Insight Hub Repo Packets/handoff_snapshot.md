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
