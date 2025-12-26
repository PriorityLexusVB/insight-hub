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
  apps: string[];
  tags: string[];
  sensitivity: "safe_internal" | "contains_customer_pii" | "external_shareable";
};

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
  // try direct parse
  try {
    return JSON.parse(s);
  } catch {
    // try to extract first {...} block
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const sub = s.slice(start, end + 1);
      return JSON.parse(sub);
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
    "tags",
    "sensitivity",
  ];
  for (const k of required) {
    if (!(k in obj)) throw new Error(`LLM JSON missing key: ${k}`);
  }
  return obj as ThreadExtract;
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

  const user = `Analyze the conversation transcript and extract:
- summary: 100–200 words, plain language
- key_decisions: list of bullets (may be empty)
- open_questions: list of bullets (may be empty)
- next_actions: up to 5 actions, each with {text, priority(low|med|high)}
- domain: one of [dealership_ops, personal, infra_agents, research]
- apps: array chosen from [AutoPro, AFTERMARKET-MENU, BDC_Leaderboard, Vehicle-in-Need, Monthly Challenges, Clarity OS, Insight Hub]
- tags: 5–15 short tags
- sensitivity: one of [safe_internal, contains_customer_pii, external_shareable]

Rules:
- If transcript appears to include customer names/phones/VINs or identifying details, set sensitivity=contains_customer_pii.
- If it’s clearly safe to share externally, set external_shareable, otherwise safe_internal.
- If there are conflicts, add an open_question noting the conflict.

Return JSON with this exact schema:
{
  "summary": "string",
  "key_decisions": ["string"],
  "open_questions": ["string"],
  "next_actions": [{"text":"string","priority":"low|med|high"}],
  "domain": "dealership_ops|personal|infra_agents|research",
  "apps": ["string"],
  "tags": ["string"],
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
