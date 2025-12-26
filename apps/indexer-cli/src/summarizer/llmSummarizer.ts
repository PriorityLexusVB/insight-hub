import fs from "fs/promises";
import path from "path";
import { RawThread } from "../importer/zipImport";
import { summariesDir } from "../paths";
import { openRouterChatComplete } from "../llm/openrouterClient";

export type ThreadExtract = {
  summary: string;
  key_decisions: string[];
  open_questions: string[];
  next_actions: Array<{ text: string; priority: "low" | "med" | "high" }>;
  domain: "dealership_ops" | "personal" | "infra_agents" | "research";
  apps: string[];        // CANONICAL project apps only (max 2)
  tools_used: string[];  // external tools/services mentioned
  tags: string[];        // cleaned tags
  sensitivity: "safe_internal" | "contains_customer_pii" | "external_shareable";
};

const CANONICAL_APPS = [
  "AutoPro",
  "AFTERMARKET-MENU",
  "BDC_Leaderboard",
  "Vehicle-in-Need",
  "Monthly Challenges",
  "Clarity OS",
  "Insight Hub",
] as const;

const JUNK_TAG_EXACT = new Set(
  [
    "div",
    "span",
    "/div",
    "class",
    "style",
    "font-size",
    "color",
    "width",
    "display",
    "table",
    "margin",
    "margin-bottom",
    "padding",
    "var",
    "px",
    "rem",
    "href",
    "src",
    "html",
    "css",
    "hljs-string",
    "hljs-keyword",
    "hljs-title",
    "hljs-number",
    "hljs-comment",
    "data-line-start",
    "data-line-end",
  ].map((x) => x.toLowerCase())
);

function redactPII(text: string): string {
  let t = text || "";
  t = t.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
  t = t.replace(/\b(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?){1}\d{3}[-.\s]?\d{4}\b/g, "[REDACTED_PHONE]");
  t = t.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, "[REDACTED_VIN]");
  return t;
}

function threadToTranscript(thread: RawThread, maxChars: number): string {
  const parts: string[] = [];
  parts.push(`TITLE: ${thread.title || "Untitled"}`);
  parts.push(`CREATED: ${thread.created_at}`);
  parts.push(`LAST_ACTIVE: ${thread.last_active_at}`);
  parts.push("");
  for (const m of thread.messages) parts.push(`${m.role.toUpperCase()}: ${m.text}`);
  const full = redactPII(parts.join("\n"));
  return full.length <= maxChars ? full : full.slice(0, maxChars) + "\n\n[TRUNCATED]\n";
}

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error("LLM did not return valid JSON.");
  }
}

function normalizeTag(tag: any): string | null {
  const t0 = String(tag ?? "").trim();
  if (!t0) return null;

  // kill obvious markup / metadata tokens
  const lower = t0.toLowerCase();
  if (JUNK_TAG_EXACT.has(lower)) return null;
  if (lower.startsWith("hljs")) return null;
  if (lower.startsWith("data-")) return null;
  if (lower.startsWith("aria-")) return null;

  if (/[<>]/.test(t0)) return null;
  if (t0.includes("/")) return null;
  if (t0.startsWith(".")) return null;
  if (t0.length < 3) return null;
  if (/^\d+$/.test(t0)) return null;

  return t0.replace(/\s+/g, " ").trim();
}

function cleanTags(tags: any): string[] {
  const arr = Array.isArray(tags) ? tags : [];
  const out: string[] = [];
  for (const x of arr) {
    const n = normalizeTag(x);
    if (n) out.push(n);
  }
  // uniq preserve order
  const seen = new Set<string>();
  const uniqOut: string[] = [];
  for (const t of out) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniqOut.push(t);
  }
  return uniqOut.slice(0, 15);
}

function validateExtract(obj: any): ThreadExtract {
  const required = [
    "summary",
    "key_decisions",
    "open_questions",
    "next_actions",
    "domain",
    "apps",
    "tools_used",
    "tags",
    "sensitivity",
  ];
  for (const k of required) {
    if (!(k in obj)) throw new Error(`LLM JSON missing key: ${k}`);
  }

  // apps: canonical only, max 2
  const appsIn = Array.isArray(obj.apps) ? obj.apps.map(String) : [];
  const appsCanonical = appsIn.filter((a) => (CANONICAL_APPS as readonly string[]).includes(a));
  obj.apps = appsCanonical.slice(0, 2);

  // tools_used: short strings only
  const tools = Array.isArray(obj.tools_used) ? obj.tools_used : [];
  obj.tools_used = tools.map((t: any) => String(t)).filter((t: string) => t.length > 1).slice(0, 20);

  // tags: cleaned
  obj.tags = cleanTags(obj.tags);

  return obj as ThreadExtract;
}

export async function llmSummarizeThread(thread: RawThread): Promise<ThreadExtract> {
  await fs.mkdir(summariesDir(), { recursive: true });

  const cachePath = path.join(summariesDir(), `${thread.thread_uid}.json`);
  try {
    const cached = await fs.readFile(cachePath, "utf8");
    return validateExtract(JSON.parse(cached));
  } catch {
    // cache miss -> call LLM
  }

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const transcript = threadToTranscript(thread, 14000);

  const system = `You are Thread Librarian.
Return ONLY valid JSON. No markdown, no extra text.
Be conservative: fewer tags/apps unless obvious.`;

  const user = `Extract structured knowledge from this conversation.

CANONICAL PROJECT APPS (apps MUST ONLY use these; max 2):
${CANONICAL_APPS.map((a) => `- ${a}`).join("\n")}

Rules:
- apps: only pick from CANONICAL PROJECT APPS; max 2; if none apply, [].
- tools_used: external tools/services mentioned (CapCut, Instagram, ElevenLabs, Twilio, Firebase, Supabase, etc.)
- tags: 5–15; avoid HTML/CSS/code tokens (div, span, class, style, hljs*, data-*).
- sensitivity: if it includes customer names/phones/VINs or identifying details, use contains_customer_pii.

Return JSON with EXACT schema:
{
  "summary": "string (100-200 words)",
  "key_decisions": ["string"],
  "open_questions": ["string"],
  "next_actions": [{"text":"string","priority":"low|med|high"}],
  "domain": "dealership_ops|personal|infra_agents|research",
  "apps": ["AutoPro|AFTERMARKET-MENU|BDC_Leaderboard|Vehicle-in-Need|Monthly Challenges|Clarity OS|Insight Hub"],
  "tools_used": ["string"],
  "tags": ["string (5-15)"],
  "sensitivity": "safe_internal|contains_customer_pii|external_shareable"
}

TRANSCRIPT:
<<<
${transcript}
>>>`;

  const out = await openRouterChatComplete({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: 900,
  });

  const parsed = safeJsonParse(out);
  const extract = validateExtract(parsed);

  await fs.writeFile(cachePath, JSON.stringify(extract, null, 2), "utf8");
  return extract;
}
