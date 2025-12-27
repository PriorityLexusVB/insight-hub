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
  thread_id: string;
  title: string;
  word_count: number;
  emdash_count: number;
  constraint_count: number;
  CDI: number;

  messages_total: number | null;
  messages_user: number | null;
  messages_assistant: number | null;
  turns_total: number | null;
  CWID: number | null;

  system_maturity: number;
  cognitive_load: number;

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

function detectEol(s: string): string {
  return s.includes("\r\n") ? "\r\n" : "\n";
}

function splitFrontmatter(md: string): Frontmatter | null {
  if (!md.startsWith("---")) return null;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return null;
  const fm = md.slice(3, end).trim();
  try {
    return (yaml.load(fm) as Frontmatter) || null;
  } catch {
    return null;
  }
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

export function classifyWorkType(text: string): { is_work: boolean; work_type: WorkType } {
  const t = (text || "").toLowerCase();

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
    ])
  ) {
    return { is_work: true, work_type: "technical" };
  }

  if (hasAny(["brochure", "poster", "design", "canva", "figma", "slide", "deck", "logo"])) {
    return { is_work: true, work_type: "creative" };
  }

  if (hasAny(["hire", "onboarding", "training", "team", "manager", "coaching", "accountability"])) {
    return { is_work: true, work_type: "leadership" };
  }

  if (hasAny(["process", "sop", "checklist", "vendor", "schedule", "inventory", "crm", "dealership"])) {
    return { is_work: true, work_type: "ops" };
  }

  if (hasAny(["strategy", "roadmap", "okr", "kpi", "plan"])) {
    return { is_work: true, work_type: "strategy" };
  }

  if (hasAny(["email", "memo", "announcement", "stakeholder", "comms", "communication"])) {
    return { is_work: true, work_type: "comms" };
  }

  return { is_work: false, work_type: "unknown" };
}

function computeSystemMaturity(md: string): number {
  const t = (md || "").toLowerCase();
  let score = 0;

  const headings = [
    "checklist",
    "sop",
    "next steps",
    "acceptance criteria",
    "rollback",
    "verify",
  ];

  for (const h of headings) {
    if (t.includes(h)) score += 10;
  }

  const numberedSteps = (md.match(/^\s*\d+\.[ \t]+/gm) || []).length;
  if (numberedSteps >= 3) score += 20;

  const tableLines = (md.match(/^\s*\|.*\|\s*$/gm) || []).length;
  if (tableLines >= 2) score += 10;

  return Math.max(0, Math.min(100, score));
}

function computeCognitiveLoad(params: {
  wordCount: number;
  CDI: number;
  turnsTotal: number | null;
}): number {
  const turns = params.turnsTotal ?? 0;
  const load =
    params.wordCount * (1 + params.CDI / 1000) * (1 + turns / 50);
  return load;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[\r\n,\"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toChatIndexCsv(rows: ChatIndexRow[]): string {
  const header: Array<keyof ChatIndexRow> = [
    "thread_id",
    "title",
    "word_count",
    "emdash_count",
    "constraint_count",
    "CDI",
    "messages_total",
    "messages_user",
    "messages_assistant",
    "turns_total",
    "CWID",
    "system_maturity",
    "cognitive_load",
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
  const want = new Set([
    "conversations.json",
    "conversations.jsonl",
    "conversations.ndjson",
  ]);

  const skip = new Set([
    "node_modules",
    ".git",
    "dist",
    "patches",
    "thread-vault",
    "analytics",
  ]);

  const out: string[] = [];

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
      if (want.has(ent.name)) out.push(path.join(dir, ent.name));
    }
  }

  await walk(root, 0);
  return out;
}

function extractCountsFromConversationObject(obj: any): ConversationMessageCounts | null {
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
  return [...arr]
    .sort((a, b) => score(b) - score(a))
    .slice(0, n);
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
      `- ${r.thread_id} — ${r.title} (${params.scoreLabel}=${params.score(r).toFixed(
        2
      )})`
    );
  }
  lines.push("");
  return lines.join("\n");
}

export async function runAnalyzeCommand(opts: AnalyzeOptions = {}): Promise<void> {
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
    const threadId = file.replace(/\.md$/i, "");
    const abs = path.join(threadsPath, file);
    const md = await fs.readFile(abs, "utf8");

    const fm = splitFrontmatter(md) || {};
    const title = String(fm.title ?? "").trim() || "Untitled";

    const body = md.includes("---") ? md.slice(md.indexOf("\n---", 3) + 4) : md;
    const bodyNoCode = stripCodeFences(body);

    const emdashCount = (bodyNoCode.match(/—/g) || []).length;
    const constraintCount = (bodyNoCode.match(CONSTRAINT_RE) || []).length;
    const wordCount = countWords(bodyNoCode);
    const CDI = computeCDI({
      wordCount,
      emdashCount,
      constraintCount,
    });

    const counts = messageCountsById.get(threadId) || null;
    const turnsTotal = counts ? counts.messages_total : null;

    const CWID = turnsTotal !== null ? turnsTotal * CDI : null;

    const systemMaturity = computeSystemMaturity(bodyNoCode);
    const cognitiveLoad = computeCognitiveLoad({
      wordCount,
      CDI,
      turnsTotal,
    });

    const classText = `${title}\n${bodyNoCode}`;
    const { is_work, work_type } = classifyWorkType(classText);

    rows.push({
      thread_id: threadId,
      title,
      word_count: wordCount,
      emdash_count: emdashCount,
      constraint_count: constraintCount,
      CDI,
      messages_total: counts ? counts.messages_total : null,
      messages_user: counts ? counts.messages_user : null,
      messages_assistant: counts ? counts.messages_assistant : null,
      turns_total: turnsTotal,
      CWID,
      system_maturity: systemMaturity,
      cognitive_load: cognitiveLoad,
      is_work,
      work_type,
    });
  }

  const chatIndexJson = path.join(outDir, "chat_index.json");
  const chatIndexCsv = path.join(outDir, "chat_index.csv");

  await fs.writeFile(chatIndexJson, JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(chatIndexCsv, toChatIndexCsv(rows), "utf8");

  const workOnlyRows = rows.filter(
    (r) => r.is_work && r.work_type !== "entertainment" && r.work_type !== "personal"
  );

  const workOnlyCsv = path.join(outDir, "work_only.csv");
  await fs.writeFile(workOnlyCsv, toChatIndexCsv(workOnlyRows), "utf8");

  const summaryScope = opts.workOnly ? workOnlyRows : rows.filter((r) => r.is_work);

  const workSummaryMd = path.join(outDir, "work_summary.md");
  const workSummaryLines: string[] = [];
  workSummaryLines.push("# Work Summary");
  workSummaryLines.push("");
  workSummaryLines.push(
    `Scope: ${opts.workOnly ? "work-only" : "is_work"} threads. Count=${summaryScope.length}`
  );
  workSummaryLines.push("");
  workSummaryLines.push(
    renderTopList({
      title: "Top 10 CWID",
      rows: summaryScope,
      n: 10,
      scoreLabel: "CWID",
      score: (r) => r.CWID ?? 0,
    })
  );
  workSummaryLines.push(
    renderTopList({
      title: "Top 10 Cognitive Load",
      rows: summaryScope,
      n: 10,
      scoreLabel: "Load",
      score: (r) => r.cognitive_load,
    })
  );
  workSummaryLines.push(
    renderTopList({
      title: "Top 10 System Maturity",
      rows: summaryScope,
      n: 10,
      scoreLabel: "Maturity",
      score: (r) => r.system_maturity,
    })
  );

  await fs.writeFile(workSummaryMd, workSummaryLines.join("\n"), "utf8");

  const leadershipVsBuilderMd = path.join(outDir, "leadership_vs_builder.md");
  const leadLines: string[] = [];
  leadLines.push("# Leadership vs Builder");
  leadLines.push("");

  const scope = opts.workOnly ? workOnlyRows : rows;
  const leaders = scope.filter((r) => r.work_type === "leadership" || r.work_type === "ops");
  const builders = scope.filter((r) => r.work_type === "technical" || r.work_type === "creative");

  leadLines.push(`Scope threads: ${scope.length}`);
  leadLines.push(`Leadership/ops: ${leaders.length}`);
  leadLines.push(`Builder (technical/creative): ${builders.length}`);
  leadLines.push("");

  leadLines.push(
    renderTopList({
      title: "Top 10 Leadership CWID",
      rows: leaders,
      n: 10,
      scoreLabel: "CWID",
      score: (r) => r.CWID ?? 0,
    })
  );
  leadLines.push(
    renderTopList({
      title: "Top 10 Builder CWID",
      rows: builders,
      n: 10,
      scoreLabel: "CWID",
      score: (r) => r.CWID ?? 0,
    })
  );

  await fs.writeFile(leadershipVsBuilderMd, leadLines.join("\n"), "utf8");

  const leverageAuditMd = path.join(outDir, "leverage_audit.md");
  const auditLines: string[] = [];
  auditLines.push("# Leverage Audit");
  auditLines.push("");
  auditLines.push(
    `Heuristic: high cognitive load + low maturity = good SOP candidate. Scope=${scope.length}`
  );
  auditLines.push("");

  const sopCandidates = [...scope]
    .filter((r) => r.is_work)
    .sort((a, b) => b.cognitive_load - a.cognitive_load)
    .filter((r) => r.system_maturity <= 30)
    .slice(0, 10);

  auditLines.push("## Top 10 SOP candidates (high load, low maturity)");
  auditLines.push("");
  if (!sopCandidates.length) {
    auditLines.push("- (none)");
  } else {
    for (const r of sopCandidates) {
      auditLines.push(
        `- ${r.thread_id} — ${r.title} (Load=${r.cognitive_load.toFixed(
          2
        )}, Maturity=${r.system_maturity}, CDI=${r.CDI.toFixed(2)})`
      );
    }
  }
  auditLines.push("");

  const bestSystems = [...scope]
    .filter((r) => r.is_work)
    .sort((a, b) => b.system_maturity - a.system_maturity)
    .slice(0, 10);

  auditLines.push("## Top 10 most mature (system indicators)");
  auditLines.push("");
  if (!bestSystems.length) {
    auditLines.push("- (none)");
  } else {
    for (const r of bestSystems) {
      auditLines.push(
        `- ${r.thread_id} — ${r.title} (Maturity=${r.system_maturity}, Load=${r.cognitive_load.toFixed(
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
  computeSystemMaturity,
};
