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

**See [RUNBOOK_TRIAGE.md](./RUNBOOK_TRIAGE.md) for the complete hardened triage workflow.**

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
**RECOMMENDED: Use the new hardened workflow:** `bash scripts/triage_run.sh --help`
**See [RUNBOOK_TRIAGE.md](./RUNBOOK_TRIAGE.md) for complete documentation.**

Quick start:
```bash
# Generate batch + get suggestions
bash scripts/triage_run.sh --batch-id 001 --threshold 0.75
# ... follow prompts to get LLM suggestions ...

# Apply patch
bash scripts/triage_run.sh --batch-id 001 --apply
```

Manual workflow (old):
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
