import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { threadsDir, repoRoot } from "../paths";

export type WorkType =
  | "ops"
  | "leadership"
  | "strategy"
  | "comms"
  | "creative"
  | "technical"
  | "personal"
  | "entertainment"
  | "unknown";

export type ChatIndexRow = {
  thread_uid: string;
  title: string;

  // Metadata from front matter
  created_at: string | null;
  last_active_at: string | null;
  domain: string;
  apps: string[];
  tags: string[];
  primary_home_file: string;
  primary_home_section: string;
  router_confidence: number | null;
  cluster_id: string;

  word_count: number;
  emdash_count: number;
  constraint_count: number;
  CDI: number;

  // Conversation-derived or proxy-derived
  turns_total: number | null;
  user_turns: number | null;
  assistant_turns: number | null;
  messages_total: number | null;
  cwid: number | null;
  cwid_is_proxy: boolean;

  maturity_score: number;
  load_score: number;

  is_work: boolean;
  work_type: WorkType;
};

type Frontmatter = Record<string, any>;

type ConversationMessageCounts = {
  messages_total: number;
  messages_user: number;
  messages_assistant: number;
};

type AnalyzeOptions = {
  out?: string;
  workOnly?: boolean;
  emitHtml?: boolean;
  emitRollup?: boolean;
  paths?: {
    repoRoot: string;
    threadsDir: string;
  };
};

type RollupKeyType = "cluster_id" | "primary_home_file" | "missing";

type RollupAlias = {
  thread_uid: string;
  title: string;
  primary_home_file: string;
  created_at: string | null;
  last_active_at: string | null;
  cwid: number | null;
  load_score: number;
};

type RollupRow = ChatIndexRow & {
  dedupe_key_type: RollupKeyType;
  dedupe_key: string;
  dupe_count: number;
  sum_load: number;
  max_load: number;
  aliases: RollupAlias[];
};

type DedupeReportGroup = {
  dedupe_key_type: RollupKeyType;
  dedupe_key: string;
  dupe_count: number;
  winner: {
    thread_uid: string;
    title: string;
    sort_tuple: [number, number, number, string];
  };
  losers: Array<{
    thread_uid: string;
    title: string;
    sort_tuple: [number, number, number, string];
  }>;
};

function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function parseTimeMs(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function numOrNegInf(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : -Infinity;
}

function rollupKeyForRow(row: ChatIndexRow): {
  dedupe_key_type: RollupKeyType;
  dedupe_key: string;
} {
  const clusterId = (row.cluster_id || "").trim();
  if (clusterId)
    return { dedupe_key_type: "cluster_id", dedupe_key: clusterId };

  const home = (row.primary_home_file || "").trim();
  if (home) return { dedupe_key_type: "primary_home_file", dedupe_key: home };

  return {
    dedupe_key_type: "missing",
    dedupe_key: `missing:${row.thread_uid}`,
  };
}

function rollupSortTuple(row: ChatIndexRow): [number, number, number, string] {
  return [
    numOrNegInf(row.cwid),
    numOrNegInf(row.load_score),
    parseTimeMs(row.last_active_at),
    row.thread_uid,
  ];
}

function compareTupleDesc(
  a: [number, number, number, string],
  b: [number, number, number, string]
): number {
  // Desc on first 3 numeric fields; asc on stable id.
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (b[i] as number) - (a[i] as number);
  }
  if (a[3] < b[3]) return -1;
  if (a[3] > b[3]) return 1;
  return 0;
}

function renderRollupMd(params: {
  repoRoot: string;
  outDir: string;
  rollupDir: string;
  rollups: RollupRow[];
  rowsTotal: number;
  mergedGroups: number;
  missingClusterIdCount: number;
  primaryHomeFallbackMergedGroups: number;
  clusterIdMultiHomeGroups: Array<{
    key: string;
    homes: string[];
    dupe_count: number;
  }>;
}): string {
  const lines: string[] = [];

  const relToThread = (uid: string) => {
    const abs = path.join(
      params.repoRoot,
      "thread-vault",
      "threads",
      `${uid}.md`
    );
    return toPosixPath(path.relative(params.rollupDir, abs));
  };
  const relToHome = (p: string) => {
    const abs = path.join(params.repoRoot, p);
    return toPosixPath(path.relative(params.rollupDir, abs));
  };

  lines.push("# Rollup");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(
    `- Out dir: ${toPosixPath(
      path.relative(params.repoRoot, params.outDir) || "."
    )}`
  );
  lines.push(`- Total threads: ${params.rowsTotal}`);
  lines.push(`- Rollup units: ${params.rollups.length}`);
  lines.push(`- Dedupe savings: ${params.rowsTotal - params.rollups.length}`);
  lines.push(`- Merged groups: ${params.mergedGroups}`);
  lines.push(`- Missing cluster_id (count): ${params.missingClusterIdCount}`);
  lines.push(
    `- Fallback merged groups by primary_home_file: ${params.primaryHomeFallbackMergedGroups}`
  );
  lines.push("");

  const topBy = (
    title: string,
    getMetric: (r: RollupRow) => number,
    digits: number
  ) => {
    const top = params.rollups
      .slice()
      .sort((a, b) => {
        const av = getMetric(a);
        const bv = getMetric(b);
        if (bv !== av) return bv - av;
        // tie-break: load desc, then last_active desc, then thread_uid
        const tA = rollupSortTuple(a);
        const tB = rollupSortTuple(b);
        return compareTupleDesc(tA, tB);
      })
      .slice(0, 20);

    lines.push(`## ${title}`);
    lines.push("");
    lines.push("| metric | load | dupes | work_type | title | thread | home |");
    lines.push("|---:|---:|---:|---|---|---|---|");
    for (const r of top) {
      const metric = getMetric(r);
      const mStr = Number.isFinite(metric) ? metric.toFixed(digits) : "";
      const threadLink = `[${r.thread_uid}](${relToThread(r.thread_uid)})`;
      const homeLink = r.primary_home_file
        ? `[${r.primary_home_file}](${relToHome(r.primary_home_file)})`
        : "";
      lines.push(
        `| ${mStr} | ${r.max_load.toFixed(2)} | ${r.dupe_count} | ${
          r.work_type
        } | ${escapeMd(r.title)} | ${threadLink} | ${homeLink} |`
      );
    }
    lines.push("");
  };

  topBy("Top 20 by CWID (winner)", (r) => numOrNegInf(r.cwid), 2);
  topBy("Top 20 by load_score (max)", (r) => r.max_load, 2);
  topBy("Top 20 by CDI (winner)", (r) => numOrNegInf(r.CDI), 2);

  if (params.clusterIdMultiHomeGroups.length) {
    lines.push("## Collisions: cluster_id spans multiple primary_home_file");
    lines.push("");
    lines.push("| cluster_id | dupes | home files |");
    lines.push("|---|---:|---|");
    for (const g of params.clusterIdMultiHomeGroups.slice(0, 25)) {
      lines.push(
        `| ${escapeMd(g.key)} | ${g.dupe_count} | ${escapeMd(
          g.homes.join(", ")
        )} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderCollisionsMd(params: {
  rollups: RollupRow[];
  missingClusterIdCount: number;
  homeFallbackMergeMax: number;
  primaryHomeFallbackMergedGroups: number;
  primaryHomeMergedGroups: Array<{
    home: string;
    dupe_count: number;
    sample_titles: string[];
  }>;
  primaryHomeFallbackPreventedGroups: Array<{
    home: string;
    dupe_count: number;
    sample_titles: string[];
  }>;
  clusterIdMultiHomeGroups: Array<{
    key: string;
    homes: string[];
    dupe_count: number;
  }>;
}): string {
  const lines: string[] = [];
  lines.push("# Collisions");
  lines.push("");
  lines.push(`- Missing cluster_id (count): ${params.missingClusterIdCount}`);
  lines.push(
    `- Fallback merged groups by primary_home_file (<= ${params.homeFallbackMergeMax}): ${params.primaryHomeFallbackMergedGroups}`
  );
  lines.push(
    `- Fallback prevented by primary_home_file (> ${params.homeFallbackMergeMax}): ${params.primaryHomeFallbackPreventedGroups.length}`
  );
  lines.push(
    `- cluster_id with multiple primary_home_file: ${params.clusterIdMultiHomeGroups.length}`
  );
  lines.push("");

  if (params.primaryHomeMergedGroups.length) {
    lines.push("## Fallback merges by primary_home_file");
    lines.push("");
    lines.push("| home file | dupes | sample titles |");
    lines.push("|---|---:|---|");
    for (const g of params.primaryHomeMergedGroups) {
      const titles = g.sample_titles.map((t) => escapeMd(t)).join("; ");
      lines.push(`| ${escapeMd(g.home)} | ${g.dupe_count} | ${titles} |`);
    }
    lines.push("");
  }

  if (params.primaryHomeFallbackPreventedGroups.length) {
    lines.push(
      "## Fallback prevented: primary_home_file groups too large (not merged)"
    );
    lines.push("");
    lines.push("| home file | dupes | sample titles |");
    lines.push("|---|---:|---|");
    for (const g of params.primaryHomeFallbackPreventedGroups) {
      const titles = g.sample_titles.map((t) => escapeMd(t)).join("; ");
      lines.push(`| ${escapeMd(g.home)} | ${g.dupe_count} | ${titles} |`);
    }
    lines.push("");
  }

  if (params.clusterIdMultiHomeGroups.length) {
    lines.push("## cluster_id spans multiple primary_home_file");
    lines.push("");
    lines.push("| cluster_id | dupes | home files |");
    lines.push("|---|---:|---|");
    for (const g of params.clusterIdMultiHomeGroups.slice(0, 50)) {
      lines.push(
        `| ${escapeMd(g.key)} | ${g.dupe_count} | ${escapeMd(
          g.homes.join(", ")
        )} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function safeJsonForInlineScript(json: string): string {
  // Prevent accidental `</script>` injection when embedding JSON in a script context.
  return json.replace(/</g, "\\u003c");
}

function escapeMd(s: string): string {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function renderAnalyticsDataJs(params: {
  rows: ChatIndexRow[];
  generatedAtIso: string;
  outDir: string;
}): string {
  const rowsJson = safeJsonForInlineScript(JSON.stringify(params.rows));
  const metaJson = safeJsonForInlineScript(
    JSON.stringify({
      generated_at: params.generatedAtIso,
      out_dir: params.outDir,
    })
  );

  return [
    "// Generated by indexer analyze --emit-html",
    `window.__CHAT_INDEX__ = ${rowsJson};`,
    `window.__ANALYTICS_META__ = ${metaJson};`,
    "",
  ].join("\n");
}

function renderAnalyticsIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Insight Hub Analytics</title>
    <style>
      :root {
        --bg: #0b0e14;
        --panel: #111827;
        --panel2: #0f172a;
        --text: #e5e7eb;
        --muted: #9ca3af;
        --border: #1f2937;
        --accent: #60a5fa;
        --bad: #f87171;
        --good: #34d399;
        --warn: #fbbf24;
      }
      html, body { height: 100%; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
      .wrap { max-width: 1400px; margin: 0 auto; padding: 16px; }
      .topbar { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .title { font-size: 18px; font-weight: 700; }
      .meta { color: var(--muted); font-size: 12px; white-space: nowrap; }

      .cards {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-top: 12px;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 12px;
      }
      .card .k { color: var(--muted); font-size: 12px; }
      .card .v { font-size: 20px; font-weight: 800; margin-top: 2px; }

      .controls {
        margin-top: 12px;
        background: var(--panel2);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 12px;
        display: grid;
        grid-template-columns: 1fr auto auto auto;
        gap: 10px;
        align-items: center;
      }
      .controls input[type="text"] {
        width: 100%;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: #0b1220;
        color: var(--text);
        outline: none;
      }
      .controls label { color: var(--text); font-size: 12px; display: inline-flex; gap: 6px; align-items: center; }
      .controls select {
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: #0b1220;
        color: var(--text);
        outline: none;
      }

      .tableWrap {
        margin-top: 12px;
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
        background: var(--panel);
      }
      table { width: 100%; border-collapse: collapse; }
      thead th {
        position: sticky;
        top: 0;
        background: #0b1220;
        color: var(--muted);
        text-align: left;
        font-weight: 700;
        font-size: 12px;
        border-bottom: 1px solid var(--border);
        padding: 8px 10px;
        cursor: pointer;
        white-space: nowrap;
      }
      thead th.sortActive { color: var(--text); }
      tbody td {
        border-top: 1px solid rgba(31, 41, 55, 0.6);
        padding: 8px 10px;
        vertical-align: top;
      }
      tbody tr:nth-child(odd) { background: rgba(255, 255, 255, 0.02); }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      .badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--border);
        font-size: 11px;
        color: var(--muted);
        background: rgba(255, 255, 255, 0.02);
      }
      .badge.bad { color: var(--bad); border-color: rgba(248, 113, 113, 0.4); }
      .right { text-align: right; }
      .small { font-size: 12px; color: var(--muted); }
      @media (max-width: 980px) {
        .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .controls { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="topbar">
        <div class="title">Insight Hub Analytics</div>
        <div class="meta" id="meta"></div>
      </div>

      <div class="cards">
        <div class="card"><div class="k">Total threads</div><div class="v" id="k_total">0</div></div>
        <div class="card"><div class="k">is_work</div><div class="v" id="k_work">0</div></div>
        <div class="card"><div class="k">work_only</div><div class="v" id="k_workonly">0</div></div>
        <div class="card"><div class="k">Proxy CWID</div><div class="v" id="k_proxy">0</div></div>
      </div>

      <div class="controls">
        <input id="q" type="text" placeholder="Search title/domain/apps/tags/primary_home_file..." />
        <label><input id="f_workonly" type="checkbox" /> Work-only</label>
        <label><input id="f_proxy" type="checkbox" /> Proxy CWID only</label>
        <select id="f_worktype" title="work_type">
          <option value="">All work_type</option>
        </select>
      </div>

      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th data-k="title">Title</th>
              <th data-k="work_type">work_type</th>
              <th data-k="CDI" class="right">CDI</th>
              <th data-k="cwid" class="right">CWID</th>
              <th data-k="maturity_score" class="right">maturity_score</th>
              <th data-k="load_score" class="right">load_score</th>
              <th data-k="domain">domain</th>
              <th data-k="primary_home_file">primary_home_file</th>
              <th data-k="cwid_is_proxy">proxy</th>
            </tr>
          </thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>

      <div class="small" id="status" style="margin-top: 10px;"></div>
    </div>

    <script src="./data.js"></script>
    <script>
      (function () {
        const rows = (window.__CHAT_INDEX__ || []);
        const meta = (window.__ANALYTICS_META__ || null);

        const elMeta = document.getElementById('meta');
        if (meta && meta.generated_at) {
          elMeta.textContent = 'Generated: ' + meta.generated_at;
        }

        // Summary cards
        const total = rows.length;
        const isWork = rows.filter(r => r && r.is_work).length;
        const workOnly = rows.filter(r => r && r.is_work && r.work_type !== 'entertainment' && r.work_type !== 'personal').length;
        const proxy = rows.filter(r => r && r.cwid_is_proxy).length;
        document.getElementById('k_total').textContent = String(total);
        document.getElementById('k_work').textContent = String(isWork);
        document.getElementById('k_workonly').textContent = String(workOnly);
        document.getElementById('k_proxy').textContent = String(proxy);

        // Work type dropdown
        const workTypes = Array.from(new Set(rows.map(r => String(r && r.work_type || '')).filter(Boolean))).sort();
        const sel = document.getElementById('f_worktype');
        for (const wt of workTypes) {
          const opt = document.createElement('option');
          opt.value = wt;
          opt.textContent = wt;
          sel.appendChild(opt);
        }

        const state = {
          q: '',
          onlyWork: false,
          onlyProxy: false,
          workType: '',
          sortKey: 'cwid',
          sortDir: 'desc',
        };

        function textOfRow(r) {
          const apps = Array.isArray(r.apps) ? r.apps.join(' ') : String(r.apps || '');
          const tags = Array.isArray(r.tags) ? r.tags.join(' ') : String(r.tags || '');
          return [r.title, r.domain, apps, tags, r.primary_home_file].join(' ').toLowerCase();
        }

        function passesFilters(r) {
          if (!r) return false;
          if (state.onlyWork) {
            if (!r.is_work) return false;
            if (r.work_type === 'entertainment' || r.work_type === 'personal') return false;
          }
          if (state.onlyProxy && !r.cwid_is_proxy) return false;
          if (state.workType && String(r.work_type) !== state.workType) return false;
          if (state.q) {
            const t = textOfRow(r);
            if (!t.includes(state.q)) return false;
          }
          return true;
        }

        function num(v) {
          const n = typeof v === 'number' ? v : Number(v);
          return Number.isFinite(n) ? n : null;
        }

        function cmp(a, b, k, dir) {
          const asc = dir === 'asc';
          const av = a ? a[k] : null;
          const bv = b ? b[k] : null;

          const numericKeys = new Set(['CDI', 'cwid', 'maturity_score', 'load_score']);
          if (numericKeys.has(k)) {
            const an = num(av);
            const bn = num(bv);
            const ax = an === null ? -Infinity : an;
            const bx = bn === null ? -Infinity : bn;
            return asc ? (ax - bx) : (bx - ax);
          }

          const as = String(av ?? '').toLowerCase();
          const bs = String(bv ?? '').toLowerCase();
          if (as < bs) return asc ? -1 : 1;
          if (as > bs) return asc ? 1 : -1;
          return 0;
        }

        function applySort(list) {
          const out = list.slice();
          out.sort((a, b) => {
            const primary = cmp(a, b, state.sortKey, state.sortDir);
            if (primary !== 0) return primary;
            // Deterministic tiebreak: load_score desc, then title asc
            const t1 = cmp(a, b, 'load_score', 'desc');
            if (t1 !== 0) return t1;
            return cmp(a, b, 'title', 'asc');
          });
          return out;
        }

        function fmt(n, digits) {
          const x = num(n);
          if (x === null) return '';
          return x.toFixed(digits);
        }

        function threadHref(uid) {
          return '../../thread-vault/threads/' + encodeURIComponent(uid) + '.md';
        }
        function docHref(p) {
          const norm = String(p || '').replace(/\\\\/g, '/');
          return '../../' + norm;
        }

        function render() {
          const filtered = rows.filter(passesFilters);
          const sorted = applySort(filtered);

          const tbody = document.getElementById('tbody');
          tbody.textContent = '';

          for (const r of sorted) {
            const tr = document.createElement('tr');

            const tdTitle = document.createElement('td');
            const a = document.createElement('a');
            a.href = threadHref(r.thread_uid);
            a.textContent = r.title || '(untitled)';
            tdTitle.appendChild(a);
            tr.appendChild(tdTitle);

            const tdType = document.createElement('td');
            tdType.textContent = String(r.work_type || '');
            tr.appendChild(tdType);

            const tdCDI = document.createElement('td');
            tdCDI.className = 'num mono';
            tdCDI.textContent = fmt(r.CDI, 2);
            tr.appendChild(tdCDI);

            const tdCWID = document.createElement('td');
            tdCWID.className = 'num mono';
            tdCWID.textContent = fmt(r.cwid, 2);
            tr.appendChild(tdCWID);

            const tdMat = document.createElement('td');
            tdMat.className = 'num mono';
            tdMat.textContent = fmt(r.maturity_score, 0);
            tr.appendChild(tdMat);

            const tdLoad = document.createElement('td');
            tdLoad.className = 'num mono';
            tdLoad.textContent = fmt(r.load_score, 2);
            tr.appendChild(tdLoad);

            const tdDomain = document.createElement('td');
            tdDomain.textContent = String(r.domain || '');
            tr.appendChild(tdDomain);

            const tdHome = document.createElement('td');
            if (r.primary_home_file) {
              const a2 = document.createElement('a');
              a2.href = docHref(r.primary_home_file);
              a2.textContent = r.primary_home_file;
              tdHome.appendChild(a2);
            } else {
              tdHome.textContent = '';
            }
            tr.appendChild(tdHome);

            const tdProxy = document.createElement('td');
            if (r.cwid_is_proxy) {
              const b = document.createElement('span');
              b.className = 'badge bad';
              b.textContent = 'proxy';
              tdProxy.appendChild(b);
            } else {
              tdProxy.textContent = '';
            }
            tr.appendChild(tdProxy);

            tbody.appendChild(tr);
          }

          const status = document.getElementById('status');
          status.textContent = String(sorted.length) + ' / ' + String(rows.length) + ' rows | sort: ' + String(state.sortKey) + ' ' + String(state.sortDir);

          // Update sort header state
          document.querySelectorAll('thead th').forEach(th => {
            const k = th.getAttribute('data-k');
            th.classList.toggle('sortActive', k === state.sortKey);
            if (k === state.sortKey) {
              th.textContent = th.textContent.replace(/\\s[▲▼]$/, '');
              th.textContent = th.textContent + (state.sortDir === 'asc' ? ' ▲' : ' ▼');
            } else {
              th.textContent = th.textContent.replace(/\\s[▲▼]$/, '');
            }
          });
        }

        // Controls
        document.getElementById('q').addEventListener('input', (e) => {
          state.q = String(e.target.value || '').trim().toLowerCase();
          render();
        });
        document.getElementById('f_workonly').addEventListener('change', (e) => {
          state.onlyWork = !!e.target.checked;
          render();
        });
        document.getElementById('f_proxy').addEventListener('change', (e) => {
          state.onlyProxy = !!e.target.checked;
          render();
        });
        document.getElementById('f_worktype').addEventListener('change', (e) => {
          state.workType = String(e.target.value || '');
          render();
        });

        document.querySelectorAll('thead th').forEach(th => {
          th.addEventListener('click', () => {
            const k = th.getAttribute('data-k');
            if (!k) return;
            if (state.sortKey === k) {
              state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
              state.sortKey = k;
              state.sortDir = 'desc';
            }
            render();
          });
        });

        render();
      })();
    </script>
  </body>
</html>`;
}

export function parseFrontMatterYaml(md: string): {
  meta: Frontmatter;
  body: string;
} {
  // Robustly parse YAML front matter delimited by --- ... --- at start of file.
  // Supports nested maps/arrays via js-yaml.
  const match = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return { meta: {}, body: md };

  const fm = match[1];
  let meta: Frontmatter = {};
  try {
    const loaded = yaml.load(fm);
    if (loaded && typeof loaded === "object") meta = loaded as Frontmatter;
  } catch {
    meta = {};
  }

  const body = md.slice(match[0].length);
  return { meta, body };
}

function stripCodeFences(md: string): string {
  // Remove triple-backtick fenced blocks.
  return md.replace(/```[\s\S]*?```/g, "");
}

function countWords(text: string): number {
  const matches = (text || "")
    .replace(/\u00a0/g, " ")
    .match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g);
  return matches ? matches.length : 0;
}

const CONSTRAINT_RE = new RegExp(
  [
    "\\bmust\\b",
    "\\bshould\\b",
    "\\bavoid\\b",
    "\\bdon['’]t\\b",
    "\\bdo not\\b",
    "\\bunless\\b",
    "\\bonly if\\b",
    "\\bverify\\b",
    "\\bvalidate\\b",
    "\\brollback\\b",
    "\\bguardrail\\b",
    "\\bedge case\\b",
    "\\bacceptance criteria\\b",
    "\\bnext actions\\b",
    "\\bchecklist\\b",
    "\\bsop\\b",
  ].join("|"),
  "gi"
);

export function computeCDI(params: {
  wordCount: number;
  emdashCount: number;
  constraintCount: number;
}): number {
  const denom = Math.max(1, params.wordCount);
  return ((params.emdashCount + params.constraintCount) / denom) * 1000;
}

function normalizeStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string") return [v].filter(Boolean);
  return [];
}

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return String(v);
}

function pathStartsWithDocsSection(p: string, prefix: string): boolean {
  const norm = (p || "").replace(/\\/g, "/");
  return norm.startsWith(prefix);
}

export function classifyWork(params: {
  meta: Frontmatter;
  title: string;
  bodyText: string;
}): { is_work: boolean; work_type: WorkType } {
  const domain = safeString(params.meta.domain).toLowerCase();
  const apps = normalizeStringList(params.meta.apps).map((x) =>
    x.toLowerCase()
  );
  const router =
    params.meta.router && typeof params.meta.router === "object"
      ? (params.meta.router as any)
      : null;
  const primaryFile = safeString(router?.primary_home?.file);

  // Strong YAML signals first.
  if (domain.startsWith("dealership_")) {
    return { is_work: true, work_type: "ops" };
  }

  if (primaryFile) {
    if (pathStartsWithDocsSection(primaryFile, "docs/marketing")) {
      return { is_work: true, work_type: "comms" };
    }
    if (pathStartsWithDocsSection(primaryFile, "docs/infra")) {
      return { is_work: true, work_type: "technical" };
    }
    if (pathStartsWithDocsSection(primaryFile, "docs/personal")) {
      return { is_work: false, work_type: "personal" };
    }
    if (pathStartsWithDocsSection(primaryFile, "docs/movies")) {
      return { is_work: false, work_type: "entertainment" };
    }
  }

  if (apps.length) {
    // If apps are present and not obviously personal/entertainment, treat as work.
    const personalish = apps.some((a) =>
      ["netflix", "spotify", "movie", "watchlist", "personal"].some((k) =>
        a.includes(k)
      )
    );
    if (!personalish) {
      const technicalish = apps.some((a) =>
        ["github", "vscode", "node", "typescript", "firebase", "supabase"].some(
          (k) => a.includes(k)
        )
      );
      return { is_work: true, work_type: technicalish ? "technical" : "ops" };
    }
  }

  // Keyword fallback on title + body.
  const t = `${params.title}\n${params.bodyText}`.toLowerCase();

  const hasAny = (words: string[]): boolean => words.some((w) => t.includes(w));

  if (hasAny(["movie", "watchlist", "film", "thriller"])) {
    return { is_work: false, work_type: "entertainment" };
  }

  if (hasAny(["family", "health", "home"])) {
    return { is_work: false, work_type: "personal" };
  }

  if (
    hasAny([
      "github",
      "pull request",
      "pr",
      "branch",
      "merge",
      "pnpm",
      "node",
      "typescript",
      " ts ",
      "build",
      "deploy",
      "firebase",
      "supabase",
    ])
  ) {
    return { is_work: true, work_type: "technical" };
  }

  if (
    hasAny([
      "brochure",
      "poster",
      "design",
      "canva",
      "figma",
      "slide",
      "deck",
      "logo",
    ])
  ) {
    return { is_work: true, work_type: "creative" };
  }

  if (
    hasAny([
      "hire",
      "onboarding",
      "training",
      "coach",
      "team",
      "manager",
      "coaching",
      "accountability",
    ])
  ) {
    return { is_work: true, work_type: "leadership" };
  }

  if (
    hasAny([
      "process",
      "sop",
      "checklist",
      "vendor",
      "schedule",
      "inventory",
      "crm",
      "dealership",
    ])
  ) {
    return { is_work: true, work_type: "ops" };
  }

  if (hasAny(["strategy", "roadmap", "okr", "kpi", "plan"])) {
    return { is_work: true, work_type: "strategy" };
  }

  if (
    hasAny([
      "email",
      "memo",
      "announcement",
      "stakeholder",
      "comms",
      "communication",
    ])
  ) {
    return { is_work: true, work_type: "comms" };
  }

  return { is_work: false, work_type: "unknown" };
}

function computeMaturityScore(bodyText: string): number {
  const t = (bodyText || "").toLowerCase();
  let score = 0;

  if (t.includes("checklist") || t.includes("sop")) score += 15;
  if (
    t.includes("acceptance criteria") ||
    t.includes("verify") ||
    t.includes("rollback")
  )
    score += 15;
  if (/^\s*\d+\)\s+/m.test(bodyText)) score += 10;
  if (bodyText.includes("|")) score += 10;
  if (t.includes("next actions")) score += 10;
  if (t.includes("owner:") || t.includes("cadence:") || t.includes("metrics:"))
    score += 10;

  return Math.max(0, Math.min(100, score));
}

function computeLoadScore(params: {
  wordCount: number;
  CDI: number;
  turns: number;
}): number {
  return params.wordCount * (1 + params.CDI / 1000) * (1 + params.turns / 50);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;

  if (Array.isArray(value)) {
    // Keep list-ish fields drillable and unambiguous in CSV.
    s = JSON.stringify(value);
  } else if (typeof value === "object") {
    // Not expected in the stable CSV contract, but keep behavior deterministic.
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  } else {
    s = String(value);
  }

  if (/[\r\n,\"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toChatIndexCsv(rows: ChatIndexRow[]): string {
  // CSV contract (keep stable; drillable via JSON for extra fields).
  const header: Array<keyof ChatIndexRow> = [
    "thread_uid",
    "title",
    "domain",
    "apps",
    "tags",
    "primary_home_file",
    "primary_home_section",
    "router_confidence",
    "cluster_id",
    "word_count",
    "emdash_count",
    "constraint_count",
    "CDI",
    "turns_total",
    "user_turns",
    "assistant_turns",
    "cwid",
    "cwid_is_proxy",
    "maturity_score",
    "load_score",
    "is_work",
    "work_type",
  ];

  const lines: string[] = [];
  lines.push(header.join(","));
  for (const row of rows) {
    lines.push(header.map((k) => csvEscape((row as any)[k])).join(","));
  }
  return lines.join("\n") + "\n";
}

async function findConversationDataFiles(root: string): Promise<string[]> {
  const skip = new Set([
    "node_modules",
    ".git",
    "dist",
    "patches",
    "thread-vault",
    "analytics",
  ]);
  const out: string[] = [];

  const rootsToScan = [
    path.join(root, "imports"),
    path.join(root, "data"),
    path.join(root, "raw"),
    path.join(root, "conversations"),
    root,
  ];

  const seen = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }> = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (skip.has(ent.name)) continue;
        await walk(path.join(dir, ent.name), depth + 1);
        continue;
      }

      if (!ent.isFile()) continue;

      const lower = ent.name.toLowerCase();
      const isJson =
        lower.endsWith(".json") ||
        lower.endsWith(".jsonl") ||
        lower.endsWith(".ndjson");
      if (!isJson) continue;

      // Bias toward likely conversation dumps.
      const looksRelevant =
        lower.includes("conversation") ||
        lower.includes("chat") ||
        lower.includes("export");
      if (!looksRelevant) continue;

      const p = path.join(dir, ent.name);
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
  }

  for (const r of rootsToScan) {
    if (seen.has(r)) continue;
    seen.add(r);
    await walk(r, 0);
  }

  return out;
}

function extractCountsFromConversationObject(
  obj: any
): ConversationMessageCounts | null {
  if (!obj || typeof obj !== "object") return null;

  const countRole = (role: string | null | undefined): void => {
    totals.messages_total++;
    if (role === "user") totals.messages_user++;
    if (role === "assistant") totals.messages_assistant++;
  };

  const totals: ConversationMessageCounts = {
    messages_total: 0,
    messages_user: 0,
    messages_assistant: 0,
  };

  if (Array.isArray(obj.messages)) {
    for (const m of obj.messages) {
      const role = m?.author?.role ?? m?.role;
      if (!role) continue;
      countRole(String(role));
    }
    return totals.messages_total ? totals : null;
  }

  if (obj.mapping && typeof obj.mapping === "object") {
    const vals = Object.values(obj.mapping);
    for (const node of vals) {
      const msg = (node as any)?.message;
      const role = msg?.author?.role;
      if (!msg || !role) continue;
      countRole(String(role));
    }
    return totals.messages_total ? totals : null;
  }

  return null;
}

async function loadMessageCountsByThreadId(params: {
  root: string;
  threadIds: Set<string>;
}): Promise<Map<string, ConversationMessageCounts>> {
  const found = new Map<string, ConversationMessageCounts>();
  const files = await findConversationDataFiles(params.root);
  if (!files.length) return found;

  const remaining = new Set(params.threadIds);

  for (const file of files) {
    if (remaining.size === 0) break;

    if (file.endsWith(".jsonl") || file.endsWith(".ndjson")) {
      const raw = await fs.readFile(file, "utf8");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (remaining.size === 0) break;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        const id = String(obj?.id ?? obj?.conversation_id ?? "");
        if (!id || !remaining.has(id)) continue;
        const counts = extractCountsFromConversationObject(obj);
        if (counts) {
          found.set(id, counts);
          remaining.delete(id);
        }
      }
      continue;
    }

    if (file.endsWith(".json")) {
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        continue;
      }
      // Avoid loading extremely large files without a streaming parser.
      if (stat.size > 50 * 1024 * 1024) continue;

      let obj: any;
      try {
        obj = JSON.parse(await fs.readFile(file, "utf8"));
      } catch {
        continue;
      }

      const arr = Array.isArray(obj) ? obj : obj?.conversations;
      if (!Array.isArray(arr)) continue;

      for (const c of arr) {
        if (remaining.size === 0) break;
        const id = String(c?.id ?? c?.conversation_id ?? "");
        if (!id || !remaining.has(id)) continue;
        const counts = extractCountsFromConversationObject(c);
        if (counts) {
          found.set(id, counts);
          remaining.delete(id);
        }
      }
    }
  }

  return found;
}

function topN<T>(arr: T[], n: number, score: (x: T) => number): T[] {
  return [...arr].sort((a, b) => score(b) - score(a)).slice(0, n);
}

function renderTopList(params: {
  title: string;
  rows: ChatIndexRow[];
  n: number;
  scoreLabel: string;
  score: (r: ChatIndexRow) => number;
}): string {
  const lines: string[] = [];
  lines.push(`## ${params.title}`);
  lines.push("");

  const top = topN(params.rows, params.n, params.score);
  if (!top.length) {
    lines.push("- (none)");
    lines.push("");
    return lines.join("\n");
  }

  for (const r of top) {
    lines.push(
      `- ${r.thread_uid} — ${r.title} (${params.scoreLabel}=${params
        .score(r)
        .toFixed(2)})`
    );
  }
  lines.push("");
  return lines.join("\n");
}

function avg(nums: Array<number | null | undefined>): number {
  const v = nums.filter(
    (x): x is number => typeof x === "number" && Number.isFinite(x)
  );
  if (!v.length) return 0;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function approxTurnsFromDates(
  createdAtIso: string | null,
  lastActiveAtIso: string | null
): number | null {
  if (!createdAtIso || !lastActiveAtIso) return null;
  const a = new Date(createdAtIso);
  const b = new Date(lastActiveAtIso);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()))
    return null;
  const minutes = Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
  const approx = Math.round(minutes / 2);
  return clamp(approx, 2, 60);
}

function renderDataDictionaryMd(): string {
  const lines: string[] = [];
  lines.push("# Chat Index Data Dictionary");
  lines.push("");
  lines.push(
    "This describes the columns produced by `analyze` in `chat_index.csv` / `chat_index.json`."
  );
  lines.push("");

  lines.push("## Output files");
  lines.push("");
  lines.push("- `chat_index.json`: full row data (recommended for drill-down)");
  lines.push("- `chat_index.csv`: stable CSV contract for spreadsheets");
  lines.push("- `work_only.csv`: work-focused subset CSV");
  lines.push("- `work_summary.md`: work counts + top lists");
  lines.push("- `leadership_vs_builder.md`: cohort averages");
  lines.push("- `leverage_audit.md`: top 15 SOP candidates + best systems");
  lines.push("");

  lines.push("## Columns");
  lines.push("");
  lines.push(
    "- `thread_uid`: Thread identifier (from front matter; falls back to filename)"
  );
  lines.push("- `title`: Thread title (from front matter)");
  lines.push("- `domain`: Domain label from routing metadata (front matter)");
  lines.push(
    "- `apps`: List of app names (front matter). In CSV this is a JSON string."
  );
  lines.push(
    "- `tags`: List of tags (front matter). In CSV this is a JSON string."
  );
  lines.push(
    "- `primary_home_file`: Router primary home file path (front matter)"
  );
  lines.push(
    "- `primary_home_section`: Router primary home section (front matter)"
  );
  lines.push("- `router_confidence`: Router confidence (number; nullable)");
  lines.push("- `cluster_id`: Merge cluster id (front matter; may be empty)");
  lines.push(
    "- `word_count`: Word count of body text with fenced code blocks removed"
  );
  lines.push("- `emdash_count`: Count of em-dash characters (—) in body text");
  lines.push(
    "- `constraint_count`: Count of constraint phrases matched in body text"
  );
  lines.push("- `CDI`: Constraint Density Index");
  lines.push(
    "- `turns_total`: Total messages from raw conversation export if found (nullable)"
  );
  lines.push(
    "- `user_turns`: User messages from raw export if found (nullable)"
  );
  lines.push(
    "- `assistant_turns`: Assistant messages from raw export if found (nullable)"
  );
  lines.push("- `cwid`: Cognitive Workload Index Density (nullable)");
  lines.push(
    "- `cwid_is_proxy`: `true` when `cwid` uses a timestamp-based proxy turns estimate"
  );
  lines.push("- `maturity_score`: System maturity score (0–100)");
  lines.push("- `load_score`: Cognitive load score (continuous)");
  lines.push("- `is_work`: Work classification boolean");
  lines.push("- `work_type`: Work category label (ops/technical/comms/etc.)");
  lines.push("");

  lines.push("## Key formulas");
  lines.push("");
  lines.push(
    "- CDI: `((emdash_count + constraint_count) / max(1, word_count)) * 1000`"
  );
  lines.push(
    "- CWID: `turns * CDI`, where `turns = turns_total` if raw exports match; otherwise proxy turns from timestamps"
  );
  lines.push(
    "- Load: `word_count * (1 + CDI/1000) * (1 + turns/50)` where `turns = turns_total ?? approx_turns ?? 0`"
  );
  lines.push("");

  lines.push("## Proxy turns");
  lines.push("");
  lines.push(
    "When raw conversation exports are not available/matchable, turns are approximated from `created_at` and `last_active_at` as `approx_turns = clamp(round(minutes/2), 2, 60)`. In that case `turns_total/user_turns/assistant_turns` remain blank/null and `cwid_is_proxy=true`."
  );
  lines.push("");

  return lines.join("\n") + "\n";
}

export async function runAnalyzeCommand(
  opts: AnalyzeOptions = {}
): Promise<void> {
  const root = opts.paths?.repoRoot ?? repoRoot();
  const threadsPath = opts.paths?.threadsDir ?? threadsDir();

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "-")
    .slice(0, 15);

  const outDir = opts.out
    ? path.resolve(root, opts.out)
    : path.join(root, "analytics", timestamp);

  await fs.mkdir(outDir, { recursive: true });

  const threadFiles = (await fs.readdir(threadsPath))
    .filter((f) => f.endsWith(".md"))
    .sort();

  const threadIds = new Set<string>();
  for (const f of threadFiles) threadIds.add(f.replace(/\.md$/i, ""));

  const messageCountsById = await loadMessageCountsByThreadId({
    root,
    threadIds,
  });

  const rows: ChatIndexRow[] = [];

  for (const file of threadFiles) {
    const threadFileId = file.replace(/\.md$/i, "");
    const abs = path.join(threadsPath, file);
    const md = await fs.readFile(abs, "utf8");

    const { meta, body } = parseFrontMatterYaml(md);
    const threadUid = safeString(meta.thread_uid).trim() || threadFileId;
    const title = safeString(meta.title).trim() || "Untitled";

    const createdAt = safeString(meta.created_at).trim() || null;
    const lastActiveAt = safeString(meta.last_active_at).trim() || null;
    const domain = safeString(meta.domain).trim();
    const apps = normalizeStringList(meta.apps);
    const tags = normalizeStringList(meta.tags);

    const router =
      meta.router && typeof meta.router === "object"
        ? (meta.router as any)
        : null;
    const primaryHomeFile = safeString(router?.primary_home?.file).trim();
    const primaryHomeSection = safeString(router?.primary_home?.section).trim();
    const routerConfidenceRaw = router?.confidence;
    const routerConfidence =
      typeof routerConfidenceRaw === "number" &&
      Number.isFinite(routerConfidenceRaw)
        ? routerConfidenceRaw
        : null;

    const merge =
      meta.merge && typeof meta.merge === "object" ? (meta.merge as any) : null;
    const clusterId = safeString(merge?.cluster_id).trim();

    const bodyNoCode = stripCodeFences(body);

    // Confidence gate: if routing is unsure, don't let it pollute domain/home/work_type
    const ROUTER_MIN_CONF = 0.7;
    const lowConf =
      routerConfidence !== null && routerConfidence < ROUTER_MIN_CONF;

    const domainEffective = lowConf ? "unknown" : domain || "unknown";
    const primaryHomeFileEffective = lowConf ? "" : primaryHomeFile;

    // Use a sanitized meta for classifyWork so low-confidence routing doesn't force ops
    const metaForClassify: any = { ...meta };
    if (lowConf) {
      metaForClassify.domain = "";
      if (
        metaForClassify.router &&
        typeof metaForClassify.router === "object"
      ) {
        const r = { ...metaForClassify.router };
        delete r.primary_home;
        metaForClassify.router = r;
      }
    }

    const emdashCount = (bodyNoCode.match(/—/g) || []).length;
    const constraintCount = (bodyNoCode.match(CONSTRAINT_RE) || []).length;
    const wordCount = countWords(bodyNoCode);
    const CDI = computeCDI({
      wordCount,
      emdashCount,
      constraintCount,
    });

    const counts =
      messageCountsById.get(threadUid) ||
      messageCountsById.get(threadFileId) ||
      null;
    const turnsTotal = counts ? counts.messages_total : null;

    const approxTurns = approxTurnsFromDates(createdAt, lastActiveAt);
    const turnsForLoad = turnsTotal ?? approxTurns ?? 0;

    const cwidIsProxy = turnsTotal === null;
    const cwid =
      turnsTotal !== null
        ? turnsTotal * CDI
        : approxTurns !== null
        ? approxTurns * CDI
        : null;

    const maturityScore = computeMaturityScore(bodyNoCode);
    const loadScore = computeLoadScore({ wordCount, CDI, turns: turnsForLoad });

    const { is_work, work_type } = classifyWork({
      meta: metaForClassify,
      title,
      bodyText: bodyNoCode,
    });

    rows.push({
      thread_uid: threadUid,
      title,
      created_at: createdAt,
      last_active_at: lastActiveAt,
      domain: domainEffective,
      apps,
      tags,
      primary_home_file: primaryHomeFileEffective,
      primary_home_section: primaryHomeSection,
      router_confidence: routerConfidence,
      cluster_id: clusterId,
      word_count: wordCount,
      emdash_count: emdashCount,
      constraint_count: constraintCount,
      CDI,
      turns_total: turnsTotal,
      user_turns: counts ? counts.messages_user : null,
      assistant_turns: counts ? counts.messages_assistant : null,
      messages_total: counts ? counts.messages_total : null,
      cwid,
      cwid_is_proxy: cwidIsProxy,
      maturity_score: maturityScore,
      load_score: loadScore,
      is_work,
      work_type,
    });
  }

  const chatIndexJson = path.join(outDir, "chat_index.json");
  const chatIndexCsv = path.join(outDir, "chat_index.csv");
  const dataDictionaryMd = path.join(outDir, "data_dictionary.md");
  const analyticsDataJs = path.join(outDir, "data.js");
  const analyticsIndexHtml = path.join(outDir, "index.html");

  await fs.writeFile(chatIndexJson, JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(chatIndexCsv, toChatIndexCsv(rows), "utf8");
  await fs.writeFile(dataDictionaryMd, renderDataDictionaryMd(), "utf8");

  if (opts.emitRollup) {
    const rollupDir = path.join(outDir, "rollup");
    await fs.mkdir(rollupDir, { recursive: true });

    const HOME_FALLBACK_MERGE_MAX = 3;

    const homeCounts = new Map<string, number>();
    for (const r of rows) {
      const hasCluster = (r.cluster_id || "").trim().length > 0;
      const home = (r.primary_home_file || "").trim();
      if (!hasCluster && home) {
        homeCounts.set(home, (homeCounts.get(home) ?? 0) + 1);
      }
    }

    const primaryHomeFallbackPreventedSet = new Set<string>();
    for (const [home, count] of homeCounts.entries()) {
      if (count > HOME_FALLBACK_MERGE_MAX)
        primaryHomeFallbackPreventedSet.add(home);
    }

    const primaryHomeFallbackPreventedRows = new Map<string, ChatIndexRow[]>();
    for (const r of rows) {
      const hasCluster = (r.cluster_id || "").trim().length > 0;
      const home = (r.primary_home_file || "").trim();
      if (!hasCluster && home && primaryHomeFallbackPreventedSet.has(home)) {
        const arr = primaryHomeFallbackPreventedRows.get(home);
        if (arr) arr.push(r);
        else primaryHomeFallbackPreventedRows.set(home, [r]);
      }
    }

    const groups = new Map<
      string,
      { keyType: RollupKeyType; key: string; rows: ChatIndexRow[] }
    >();
    for (const r of rows) {
      const clusterId = (r.cluster_id || "").trim();
      if (clusterId) {
        const mapKey = `cluster_id:${clusterId}`;
        const existing = groups.get(mapKey);
        if (existing) existing.rows.push(r);
        else
          groups.set(mapKey, {
            keyType: "cluster_id",
            key: clusterId,
            rows: [r],
          });
        continue;
      }

      const home = (r.primary_home_file || "").trim();
      const homeCount = home ? homeCounts.get(home) ?? 0 : 0;

      // Only merge by home when it's small; otherwise treat as "missing" (no merge).
      if (home && homeCount > 1 && homeCount <= HOME_FALLBACK_MERGE_MAX) {
        const mapKey = `primary_home_file:${home}`;
        const existing = groups.get(mapKey);
        if (existing) existing.rows.push(r);
        else
          groups.set(mapKey, {
            keyType: "primary_home_file",
            key: home,
            rows: [r],
          });
        continue;
      }

      const mapKey = `missing:missing:${r.thread_uid}`;
      groups.set(mapKey, {
        keyType: "missing",
        key: `missing:${r.thread_uid}`,
        rows: [r],
      });
    }

    const rollups: RollupRow[] = [];
    const dedupeReport: DedupeReportGroup[] = [];

    const missingClusterIdCount = rows.filter(
      (r) => !(r.cluster_id || "").trim()
    ).length;
    let mergedGroups = 0;
    let primaryHomeFallbackMergedGroups = 0;

    const primaryHomeMergedGroups: Array<{
      home: string;
      dupe_count: number;
      sample_titles: string[];
    }> = [];

    const primaryHomeFallbackPreventedGroups: Array<{
      home: string;
      dupe_count: number;
      sample_titles: string[];
    }> = Array.from(primaryHomeFallbackPreventedRows.entries())
      .map(([home, rs]) => {
        const sorted = rs
          .slice()
          .sort((a, b) =>
            compareTupleDesc(rollupSortTuple(a), rollupSortTuple(b))
          );
        return {
          home,
          dupe_count: rs.length,
          sample_titles: sorted.slice(0, 3).map((r) => r.title),
        };
      })
      .sort((a, b) => {
        if (b.dupe_count !== a.dupe_count) return b.dupe_count - a.dupe_count;
        return a.home < b.home ? -1 : a.home > b.home ? 1 : 0;
      });

    const clusterIdToHomes = new Map<string, Set<string>>();
    const clusterIdToDupeCount = new Map<string, number>();

    for (const g of groups.values()) {
      const groupRows = g.rows.slice();
      groupRows.sort((a, b) =>
        compareTupleDesc(rollupSortTuple(a), rollupSortTuple(b))
      );

      const winner = groupRows[0];
      const sumLoad = groupRows.reduce(
        (acc, r) => acc + (Number.isFinite(r.load_score) ? r.load_score : 0),
        0
      );
      const maxLoad = groupRows.reduce(
        (acc, r) =>
          Math.max(
            acc,
            Number.isFinite(r.load_score) ? r.load_score : -Infinity
          ),
        -Infinity
      );

      if (g.keyType === "primary_home_file" && groupRows.length > 1) {
        primaryHomeFallbackMergedGroups++;
        primaryHomeMergedGroups.push({
          home: g.key,
          dupe_count: groupRows.length,
          sample_titles: groupRows.slice(0, 3).map((r) => r.title),
        });
      }

      if (g.keyType === "cluster_id") {
        const homes = clusterIdToHomes.get(g.key) ?? new Set<string>();
        for (const r of groupRows) {
          const h = (r.primary_home_file || "").trim();
          if (h) homes.add(h);
        }
        clusterIdToHomes.set(g.key, homes);
        clusterIdToDupeCount.set(g.key, groupRows.length);
      }

      const aliases: RollupAlias[] = groupRows.map((r) => ({
        thread_uid: r.thread_uid,
        title: r.title,
        primary_home_file: r.primary_home_file,
        created_at: r.created_at,
        last_active_at: r.last_active_at,
        cwid: r.cwid,
        load_score: r.load_score,
      }));

      rollups.push({
        ...winner,
        dedupe_key_type: g.keyType,
        dedupe_key: g.key,
        dupe_count: groupRows.length,
        sum_load: sumLoad,
        max_load: Number.isFinite(maxLoad) ? maxLoad : 0,
        aliases,
      });

      if (groupRows.length > 1) {
        mergedGroups++;
        dedupeReport.push({
          dedupe_key_type: g.keyType,
          dedupe_key: g.key,
          dupe_count: groupRows.length,
          winner: {
            thread_uid: winner.thread_uid,
            title: winner.title,
            sort_tuple: rollupSortTuple(winner),
          },
          losers: groupRows.slice(1).map((r) => ({
            thread_uid: r.thread_uid,
            title: r.title,
            sort_tuple: rollupSortTuple(r),
          })),
        });
      }
    }

    rollups.sort((a, b) =>
      compareTupleDesc(rollupSortTuple(a), rollupSortTuple(b))
    );
    dedupeReport.sort((a, b) => {
      if (a.dedupe_key_type !== b.dedupe_key_type) {
        return a.dedupe_key_type < b.dedupe_key_type ? -1 : 1;
      }
      if (a.dedupe_key !== b.dedupe_key)
        return a.dedupe_key < b.dedupe_key ? -1 : 1;
      return 0;
    });

    const clusterIdMultiHomeGroups: Array<{
      key: string;
      homes: string[];
      dupe_count: number;
    }> = [];
    for (const [clusterId, homesSet] of clusterIdToHomes.entries()) {
      const homes = Array.from(homesSet).sort();
      if (homes.length > 1) {
        clusterIdMultiHomeGroups.push({
          key: clusterId,
          homes,
          dupe_count: clusterIdToDupeCount.get(clusterId) ?? 0,
        });
      }
    }
    clusterIdMultiHomeGroups.sort((a, b) => b.dupe_count - a.dupe_count);

    primaryHomeMergedGroups.sort((a, b) => {
      if (b.dupe_count !== a.dupe_count) return b.dupe_count - a.dupe_count;
      return a.home < b.home ? -1 : a.home > b.home ? 1 : 0;
    });

    const rollupJsonPath = path.join(rollupDir, "rollup.json");
    const rollupMdPath = path.join(rollupDir, "rollup.md");
    const dedupeReportPath = path.join(rollupDir, "dedupe_report.json");
    const collisionsMdPath = path.join(rollupDir, "collisions.md");

    await fs.writeFile(
      rollupJsonPath,
      JSON.stringify(rollups, null, 2),
      "utf8"
    );
    await fs.writeFile(
      rollupMdPath,
      renderRollupMd({
        repoRoot: root,
        outDir,
        rollupDir,
        rollups,
        rowsTotal: rows.length,
        mergedGroups,
        missingClusterIdCount,
        primaryHomeFallbackMergedGroups,
        clusterIdMultiHomeGroups,
      }),
      "utf8"
    );
    await fs.writeFile(
      dedupeReportPath,
      JSON.stringify(dedupeReport, null, 2),
      "utf8"
    );
    await fs.writeFile(
      collisionsMdPath,
      renderCollisionsMd({
        rollups,
        missingClusterIdCount,
        homeFallbackMergeMax: HOME_FALLBACK_MERGE_MAX,
        primaryHomeFallbackMergedGroups,
        primaryHomeMergedGroups,
        primaryHomeFallbackPreventedGroups,
        clusterIdMultiHomeGroups,
      }),
      "utf8"
    );
  }

  if (opts.emitHtml) {
    const generatedAtIso = new Date().toISOString();
    await fs.writeFile(
      analyticsDataJs,
      renderAnalyticsDataJs({ rows, generatedAtIso, outDir }),
      "utf8"
    );
    await fs.writeFile(analyticsIndexHtml, renderAnalyticsIndexHtml(), "utf8");
  }

  const workOnlyRows = rows.filter(
    (r) =>
      r.is_work && r.work_type !== "entertainment" && r.work_type !== "personal"
  );

  const workOnlyCsv = path.join(outDir, "work_only.csv");
  await fs.writeFile(workOnlyCsv, toChatIndexCsv(workOnlyRows), "utf8");

  const workSummaryMd = path.join(outDir, "work_summary.md");
  const workSummaryLines: string[] = [];
  workSummaryLines.push("# Work Summary");
  workSummaryLines.push("");
  const workRows = rows.filter((r) => r.is_work);
  workSummaryLines.push(`Total threads: ${rows.length}`);
  workSummaryLines.push(`Work threads (is_work): ${workRows.length}`);
  workSummaryLines.push(`Work-only threads: ${workOnlyRows.length}`);
  workSummaryLines.push("");
  workSummaryLines.push(
    renderTopList({
      title: "Top 10 CWID",
      rows: workOnlyRows,
      n: 10,
      scoreLabel: "CWID",
      score: (r) => r.cwid ?? 0,
    })
  );
  workSummaryLines.push(
    renderTopList({
      title: "Top 10 Cognitive Load",
      rows: workOnlyRows,
      n: 10,
      scoreLabel: "Load",
      score: (r) => r.load_score,
    })
  );
  workSummaryLines.push(
    renderTopList({
      title: "Top 10 System Maturity",
      rows: workOnlyRows,
      n: 10,
      scoreLabel: "Maturity",
      score: (r) => r.maturity_score,
    })
  );

  await fs.writeFile(workSummaryMd, workSummaryLines.join("\n"), "utf8");

  const leadershipVsBuilderMd = path.join(outDir, "leadership_vs_builder.md");
  const leadLines: string[] = [];
  leadLines.push("# Leadership vs Builder");
  leadLines.push("");

  const scopeForCompare = opts.workOnly ? workOnlyRows : workRows;
  const leadership = scopeForCompare.filter(
    (r) => r.work_type === "leadership"
  );
  const builder = scopeForCompare.filter(
    (r) => r.work_type === "technical" || r.work_type === "ops"
  );

  leadLines.push(`Scope threads: ${scopeForCompare.length}`);
  leadLines.push("");
  leadLines.push(
    "| cohort | count | avg CDI | avg CWID | avg maturity | avg load |"
  );
  leadLines.push("|---|---:|---:|---:|---:|---:|");
  leadLines.push(
    `| leadership | ${leadership.length} | ${avg(
      leadership.map((r) => r.CDI)
    ).toFixed(2)} | ${avg(leadership.map((r) => r.cwid)).toFixed(2)} | ${avg(
      leadership.map((r) => r.maturity_score)
    ).toFixed(2)} | ${avg(leadership.map((r) => r.load_score)).toFixed(2)} |`
  );
  leadLines.push(
    `| technical/ops | ${builder.length} | ${avg(
      builder.map((r) => r.CDI)
    ).toFixed(2)} | ${avg(builder.map((r) => r.cwid)).toFixed(2)} | ${avg(
      builder.map((r) => r.maturity_score)
    ).toFixed(2)} | ${avg(builder.map((r) => r.load_score)).toFixed(2)} |`
  );
  leadLines.push("");

  await fs.writeFile(leadershipVsBuilderMd, leadLines.join("\n"), "utf8");

  const leverageAuditMd = path.join(outDir, "leverage_audit.md");
  const auditLines: string[] = [];
  auditLines.push("# Leverage Audit");
  auditLines.push("");
  const scopeForAudit = opts.workOnly ? workOnlyRows : workRows;
  auditLines.push(
    `Heuristic: high load + low maturity = systematize. Scope=${scopeForAudit.length}`
  );
  auditLines.push("");

  const sopCandidates = [...scopeForAudit]
    .filter((r) => r.maturity_score <= 30)
    .sort((a, b) => b.load_score - a.load_score)
    .slice(0, 15);

  auditLines.push("## Top 15 high load but low maturity");
  auditLines.push("");
  if (!sopCandidates.length) {
    auditLines.push("- (none)");
  } else {
    for (const r of sopCandidates) {
      auditLines.push(
        `- ${r.thread_uid} — ${r.title} (Load=${r.load_score.toFixed(
          2
        )}, Maturity=${r.maturity_score}, CDI=${r.CDI.toFixed(2)})`
      );
    }
  }
  auditLines.push("");

  const bestSystems = [...scopeForAudit]
    .sort((a, b) => b.maturity_score - a.maturity_score)
    .slice(0, 15);

  auditLines.push("## Top 15 high maturity (candidate SOP templates)");
  auditLines.push("");
  if (!bestSystems.length) {
    auditLines.push("- (none)");
  } else {
    for (const r of bestSystems) {
      auditLines.push(
        `- ${r.thread_uid} — ${r.title} (Maturity=${
          r.maturity_score
        }, Load=${r.load_score.toFixed(2)})`
      );
    }
  }
  auditLines.push("");

  await fs.writeFile(leverageAuditMd, auditLines.join("\n"), "utf8");

  console.log(`Analyze outputs: ${outDir}`);
}

export const __test__ = {
  stripCodeFences,
  countWords,
  computeMaturityScore,
};
