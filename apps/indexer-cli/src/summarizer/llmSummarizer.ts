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
  apps: CanonicalApp[];
  tools_used: string[];
  tags: string[];
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

type CanonicalApp = (typeof CANONICAL_APPS)[number];

function isCanonicalApp(s: string): s is CanonicalApp {
  return (CANONICAL_APPS as readonly string[]).includes(s);
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function clampText(s: string, maxLen: number): string {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen - 1).trimEnd() + "…";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : String(x ?? "")))
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripCodeFences(s: string): string {
  const t = (s || "").trim();
  if (!t.includes("```")) return t;
  // Prefer fenced json blocks if present
  const m = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (m && m[1]) return m[1].trim();
  // Otherwise, remove all fence markers
  return t.replace(/```/g, "").trim();
}

function redactPII(text: string): string {
  let t = text || "";
  // emails
  t = t.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[REDACTED_EMAIL]"
  );
  // phones (rough)
  t = t.replace(
    /\b(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?){1}\d{3}[-.\s]?\d{4}\b/g,
    "[REDACTED_PHONE]"
  );
  // VIN-like (17 chars)
  t = t.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, "[REDACTED_VIN]");
  return t;
}

function threadToTranscript(thread: RawThread, maxChars: number): string {
  const parts: string[] = [];
  parts.push(`TITLE: ${thread.title || "Untitled"}`);
  parts.push(`CREATED: ${thread.created_at}`);
  parts.push(`LAST_ACTIVE: ${thread.last_active_at}`);
  parts.push("");
  for (const m of thread.messages) {
    parts.push(`${m.role.toUpperCase()}: ${m.text}`);
  }
  const full = redactPII(parts.join("\n"));
  if (full.length <= maxChars) return full;
  return full.slice(0, maxChars) + "\n\n[TRUNCATED]\n";
}

function safeJsonParse(s: string): any {
  const cleaned = stripCodeFences(String(s ?? ""));

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("LLM did not return valid JSON.");
  }
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

  const domainRaw = String(obj.domain ?? "").trim();
  const domain: ThreadExtract["domain"] =
    domainRaw === "dealership_ops" ||
    domainRaw === "personal" ||
    domainRaw === "infra_agents" ||
    domainRaw === "research"
      ? domainRaw
      : "research";

  const sensitivityRaw = String(obj.sensitivity ?? "").trim();
  const sensitivity: ThreadExtract["sensitivity"] =
    sensitivityRaw === "safe_internal" ||
    sensitivityRaw === "contains_customer_pii" ||
    sensitivityRaw === "external_shareable"
      ? sensitivityRaw
      : "safe_internal";

  const apps = uniq(asStringArray(obj.apps).filter(isCanonicalApp));
  const toolsUsed = uniq(
    asStringArray(obj.tools_used).map((s) => clampText(s, 60))
  ).slice(0, 20);
  const tags = uniq(asStringArray(obj.tags).map((s) => clampText(s, 32))).slice(
    0,
    20
  );

  const keyDecisions = uniq(
    asStringArray(obj.key_decisions).map((s) => clampText(s, 220))
  ).slice(0, 20);
  const openQuestions = uniq(
    asStringArray(obj.open_questions).map((s) => clampText(s, 220))
  ).slice(0, 20);

  const nextActionsRaw = Array.isArray(obj.next_actions)
    ? obj.next_actions
    : [];
  const nextActions = nextActionsRaw
    .map((a: any) => {
      const text = clampText(String(a?.text ?? ""), 220);
      const pRaw = String(a?.priority ?? "")
        .toLowerCase()
        .trim();
      const priority: "low" | "med" | "high" =
        pRaw === "low" || pRaw === "med" || pRaw === "high" ? pRaw : "med";
      return text ? { text, priority } : null;
    })
    .filter(Boolean)
    .slice(0, 5) as Array<{ text: string; priority: "low" | "med" | "high" }>;

  const summary = clampText(String(obj.summary ?? ""), 1200);

  return {
    summary,
    key_decisions: keyDecisions,
    open_questions: openQuestions,
    next_actions: nextActions,
    domain,
    apps,
    tools_used: toolsUsed,
    tags,
    sensitivity,
  };
}

export async function llmSummarizeThread(
  thread: RawThread
): Promise<ThreadExtract> {
  await fs.mkdir(summariesDir(), { recursive: true });

  const cachePath = path.join(summariesDir(), `${thread.thread_uid}.json`);
  try {
    const cached = await fs.readFile(cachePath, "utf8");
    return validateExtract(JSON.parse(cached));
  } catch {
    // continue
  }

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  const transcript = threadToTranscript(thread, 14000);

  const system = `You are Thread Librarian.
Return ONLY valid JSON. No markdown, no extra text.
Be conservative. Prefer fewer tags/apps unless obvious.`;

  const user = `Extract structured knowledge from this conversation.

CANONICAL PROJECT APPS (apps field MUST ONLY use these if relevant):
${CANONICAL_APPS.map((a) => `- ${a}`).join("\n")}

Rules:
- summary: 100–200 words, plain language
- key_decisions: bullets (may be empty)
- open_questions: bullets (may be empty)
- next_actions: up to 5 actions, each with {text, priority(low|med|high)}
- domain: one of [dealership_ops, personal, infra_agents, research]
- apps: ONLY pick from CANONICAL PROJECT APPS. If none apply, return [].
- tools_used: external tools/services mentioned (CapCut, Instagram, ElevenLabs, Twilio, Firebase, Supabase, etc.)
- tags: 5–15 short tags
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
