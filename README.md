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
