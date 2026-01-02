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
