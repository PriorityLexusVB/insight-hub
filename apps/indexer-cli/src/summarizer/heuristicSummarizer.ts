import { RawThread } from "../importer/zipImport";

export type ThreadExtract = {
  domain: "dealership_ops" | "personal" | "infra_agents" | "research";
  apps: string[];
  tags: string[];
  sensitivity: "safe_internal" | "contains_customer_pii" | "external_shareable";
  summary: string;
  key_decisions: string[];
  open_questions: string[];
  next_actions: { text: string; priority: "low" | "med" | "high" }[];
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "so",
  "that",
  "the",
  "this",
  "to",
  "was",
  "we",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "you",
  "your",
  "they",
  "them",
  "their",
  "can",
  "could",
  "should",
  "would",
  "do",
  "does",
  "did",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_\/]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function clampSentence(s: string, maxLen: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen - 1).trimEnd() + "…";
}

function detectPII(text: string): boolean {
  const t = text || "";
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const phone = /\b(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?){1}\d{3}[-.\s]?\d{4}\b/;
  const vinLike = /\b[A-HJ-NPR-Z0-9]{17}\b/i;
  return email.test(t) || phone.test(t) || vinLike.test(t);
}

function domainFromText(allText: string): ThreadExtract["domain"] {
  const t = allText.toLowerCase();

  // dealership_ops signals
  if (
    /(lexus|dealership|bdc|appointment|calldrip|aftermarket|menu|service|trade|gross|finance|sales|cpo|l\/cert|l\-cert|ro|repair order|vin)/.test(
      t
    )
  ) {
    return "dealership_ops";
  }

  // personal signals
  if (
    /(movie|film|trailer|watched|recommend|sleep|health|pain|kids|family|routine|clarity)/.test(
      t
    )
  ) {
    return "personal";
  }

  // infra/agents/dev signals
  if (
    /(vscode|git|github|pnpm|node|typescript|next\.js|firebase|supabase|api|pr\s?#|vitest|ci|mcp|agent|aider)/.test(
      t
    )
  ) {
    return "infra_agents";
  }

  return "research";
}

function appsFromText(allText: string): string[] {
  const t = allText.toLowerCase();
  const apps: string[] = [];

  if (/(autopro|sales tracker)/.test(t)) apps.push("AutoPro");
  if (/(aftermarket\-menu|aftermarket menu|menu repo)/.test(t))
    apps.push("AFTERMARKET-MENU");
  if (/(bdc_?leaderboard|bdc leaderboard|bdc)/.test(t))
    apps.push("BDC_Leaderboard");
  if (/(vehicle\-in\-need|vehicles in need|vin)/.test(t))
    apps.push("Vehicle-in-Need");
  if (
    /(monthly challenge|mystery mario|challenge creator|admin challenge)/.test(
      t
    )
  )
    apps.push("Monthly Challenges");
  if (/(clarity os|clarity|journal)/.test(t)) apps.push("Clarity OS");
  if (
    /(insight hub|director panel|thread librarian|conversation indexer)/.test(t)
  )
    apps.push("Insight Hub");

  return uniq(apps);
}

function tagsFromThread(thread: RawThread): string[] {
  const titleTokens = tokenize(thread.title || "");
  const bodyTokens = tokenize(thread.messages.map((m) => m.text).join("\n"));

  const raw = [...titleTokens, ...bodyTokens]
    .filter((t) => t.length >= 3)
    .filter((t) => !STOPWORDS.has(t));

  // crude frequency
  const freq = new Map<string, number>();
  for (const w of raw) freq.set(w, (freq.get(w) || 0) + 1);

  const sorted = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);

  // keep it short and useful
  return uniq(sorted).slice(0, 12);
}

function questionsFromThread(thread: RawThread): string[] {
  const qs: string[] = [];
  for (const m of thread.messages) {
    if (m.role !== "user") continue;
    const lines = (m.text || "").split(/\r?\n/).map((x) => x.trim());
    for (const line of lines) {
      if (line.includes("?")) {
        const q = clampSentence(line, 180);
        if (q.length > 3) qs.push(q);
      }
    }
  }
  return uniq(qs).slice(0, 8);
}

function summaryFromThread(thread: RawThread): string {
  const userMsgs = thread.messages
    .filter((m) => m.role === "user")
    .map((m) => m.text.trim())
    .filter(Boolean);
  const asstMsgs = thread.messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.text.trim())
    .filter(Boolean);

  const firstUser = userMsgs[0] || "";
  const lastUser = userMsgs[userMsgs.length - 1] || "";
  const lastAsst = asstMsgs[asstMsgs.length - 1] || "";

  const parts: string[] = [];
  parts.push(`Thread: "${(thread.title || "Untitled").trim()}".`);

  if (firstUser) parts.push(`Started with: ${clampSentence(firstUser, 220)}`);
  if (lastUser && lastUser !== firstUser)
    parts.push(`Later: ${clampSentence(lastUser, 220)}`);
  if (lastAsst) parts.push(`Latest response: ${clampSentence(lastAsst, 240)}`);

  return parts.join(" ");
}

export function heuristicSummarize(thread: RawThread): ThreadExtract {
  const allText = `${thread.title}\n${thread.messages
    .map((m) => `${m.role}: ${m.text}`)
    .join("\n")}`;

  const sensitivity: ThreadExtract["sensitivity"] = detectPII(allText)
    ? "contains_customer_pii"
    : "safe_internal";

  return {
    domain: domainFromText(allText),
    apps: appsFromText(allText),
    tags: tagsFromThread(thread),
    sensitivity,
    summary: summaryFromThread(thread),
    key_decisions: [],
    open_questions: questionsFromThread(thread),
    next_actions: [],
  };
}
