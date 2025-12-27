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
```

Notes:

- `thread-vault/` is the source of truth for thread cards (`thread-vault/threads/*.md`).
- `docs/` is the curated knowledge base the router targets.
- `analytics/` is always generated output. By default, `analyze` writes to `analytics/<timestamp>/`.
- `--out` is resolved relative to the repo root (absolute paths also work).
