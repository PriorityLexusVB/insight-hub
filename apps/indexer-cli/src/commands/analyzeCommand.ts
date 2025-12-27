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
  paths?: {
    repoRoot: string;
    threadsDir: string;
  };
};

export function parseFrontMatterYaml(md: string): { meta: Frontmatter; body: string } {
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
  const apps = normalizeStringList(params.meta.apps).map((x) => x.toLowerCase());
  const router = (params.meta.router && typeof params.meta.router === "object")
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
  }

  if (apps.length) {
    // If apps are present and not obviously personal/entertainment, treat as work.
    const personalish = apps.some((a) =>
      ["netflix", "spotify", "movie", "watchlist", "personal"].some((k) => a.includes(k))
    );
    if (!personalish) {
      const technicalish = apps.some((a) =>
        ["github", "vscode", "node", "typescript", "firebase", "supabase"].some((k) =>
          a.includes(k)
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
  if (t.includes("acceptance criteria") || t.includes("verify") || t.includes("rollback"))
    score += 15;
  if (/^\s*\d+\)\s+/m.test(bodyText)) score += 10;
  if (bodyText.includes("|")) score += 10;
  if (t.includes("next actions")) score += 10;
  if (t.includes("owner:") || t.includes("cadence:") || t.includes("metrics:")) score += 10;

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
  const s = String(value);
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
  const skip = new Set(["node_modules", ".git", "dist", "patches", "thread-vault", "analytics"]);
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
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
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
      const isJson = lower.endsWith(".json") || lower.endsWith(".jsonl") || lower.endsWith(".ndjson");
      if (!isJson) continue;

      // Bias toward likely conversation dumps.
      const looksRelevant =
        lower.includes("conversation") || lower.includes("chat") || lower.includes("export");
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
      `- ${r.thread_uid} — ${r.title} (${params.scoreLabel}=${params.score(r).toFixed(2)})`
    );
  }
  lines.push("");
  return lines.join("\n");
}

function avg(nums: Array<number | null | undefined>): number {
  const v = nums.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return 0;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function approxTurnsFromDates(createdAtIso: string | null, lastActiveAtIso: string | null): number | null {
  if (!createdAtIso || !lastActiveAtIso) return null;
  const a = new Date(createdAtIso);
  const b = new Date(lastActiveAtIso);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return null;
  const minutes = Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
  const approx = Math.round(minutes / 2);
  return clamp(approx, 2, 60);
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

    const router = (meta.router && typeof meta.router === "object") ? (meta.router as any) : null;
    const primaryHomeFile = safeString(router?.primary_home?.file).trim();
    const primaryHomeSection = safeString(router?.primary_home?.section).trim();
    const routerConfidenceRaw = router?.confidence;
    const routerConfidence =
      typeof routerConfidenceRaw === "number" && Number.isFinite(routerConfidenceRaw)
        ? routerConfidenceRaw
        : null;

    const merge = (meta.merge && typeof meta.merge === "object") ? (meta.merge as any) : null;
    const clusterId = safeString(merge?.cluster_id).trim();

    const bodyNoCode = stripCodeFences(body);

    const emdashCount = (bodyNoCode.match(/—/g) || []).length;
    const constraintCount = (bodyNoCode.match(CONSTRAINT_RE) || []).length;
    const wordCount = countWords(bodyNoCode);
    const CDI = computeCDI({
      wordCount,
      emdashCount,
      constraintCount,
    });

    const counts = messageCountsById.get(threadUid) || messageCountsById.get(threadFileId) || null;
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

    const { is_work, work_type } = classifyWork({ meta, title, bodyText: bodyNoCode });

    rows.push({
      thread_uid: threadUid,
      title,
      created_at: createdAt,
      last_active_at: lastActiveAt,
      domain,
      apps,
      tags,
      primary_home_file: primaryHomeFile,
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

  await fs.writeFile(chatIndexJson, JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(chatIndexCsv, toChatIndexCsv(rows), "utf8");

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
  const leadership = scopeForCompare.filter((r) => r.work_type === "leadership");
  const builder = scopeForCompare.filter((r) => r.work_type === "technical" || r.work_type === "ops");

  leadLines.push(`Scope threads: ${scopeForCompare.length}`);
  leadLines.push("");
  leadLines.push("| cohort | count | avg CDI | avg CWID | avg maturity | avg load |");
  leadLines.push("|---|---:|---:|---:|---:|---:|");
  leadLines.push(
    `| leadership | ${leadership.length} | ${avg(leadership.map((r) => r.CDI)).toFixed(2)} | ${avg(
      leadership.map((r) => r.cwid)
    ).toFixed(2)} | ${avg(leadership.map((r) => r.maturity_score)).toFixed(2)} | ${avg(
      leadership.map((r) => r.load_score)
    ).toFixed(2)} |`
  );
  leadLines.push(
    `| technical/ops | ${builder.length} | ${avg(builder.map((r) => r.CDI)).toFixed(2)} | ${avg(
      builder.map((r) => r.cwid)
    ).toFixed(2)} | ${avg(builder.map((r) => r.maturity_score)).toFixed(2)} | ${avg(
      builder.map((r) => r.load_score)
    ).toFixed(2)} |`
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
        `- ${r.thread_uid} — ${r.title} (Load=${r.load_score.toFixed(2)}, Maturity=${
          r.maturity_score
        }, CDI=${r.CDI.toFixed(2)})`
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
        `- ${r.thread_uid} — ${r.title} (Maturity=${r.maturity_score}, Load=${r.load_score.toFixed(
          2
        )})`
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
