import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import unzipper from "unzipper";
import { v4 as uuidv4 } from "uuid";
import { cacheDir, rawThreadsPath, repoRoot } from "../paths";

export type RawMessage = {
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  text: string;
};

export type RawThread = {
  thread_uid: string;
  title: string;
  created_at: string; // ISO
  last_active_at: string; // ISO
  messages: RawMessage[];
};

type ExportConversation = {
  id?: string;
  title?: string;
  create_time?: number; // seconds
  update_time?: number; // seconds
  current_node?: string;
  mapping?: Record<
    string,
    {
      id?: string;
      parent?: string | null;
      children?: string[];
      message?: {
        id?: string;
        author?: { role?: string };
        create_time?: number; // seconds
        update_time?: number; // seconds
        content?: any;
      } | null;
    }
  >;
};

function isoFromSeconds(sec?: number): string {
  if (!sec || Number.isNaN(sec)) return new Date().toISOString();
  return new Date(sec * 1000).toISOString();
}

function normalizeRole(roleRaw: any): RawMessage["role"] {
  const r = String(roleRaw || "").toLowerCase();
  if (r === "user") return "user";
  if (r === "assistant") return "assistant";
  if (r === "system") return "system";
  if (r === "tool") return "tool";
  return "unknown";
}

function extractTextFromContent(content: any): string {
  if (!content) return "";

  if (Array.isArray(content.parts)) {
    const parts = content.parts
      .map((p: any) => (typeof p === "string" ? p : ""))
      .filter(Boolean);
    if (parts.length) return parts.join("\n").trim();
  }

  if (typeof content.text === "string") return content.text.trim();
  if (typeof content.result === "string") return content.result.trim();
  if (typeof content === "string") return content.trim();

  const maybe =
    content?.value ??
    content?.message ??
    content?.data ??
    content?.output ??
    content?.content;

  if (typeof maybe === "string") return maybe.trim();

  return "";
}

function buildLinearPath(
  mapping: NonNullable<ExportConversation["mapping"]>,
  currentNode?: string
): string[] {
  if (!mapping || !currentNode || !mapping[currentNode]) return [];

  const pathIds: string[] = [];
  const seen = new Set<string>();

  let nodeId: string | undefined = currentNode;

  while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
    seen.add(nodeId);
    pathIds.push(nodeId);
    const parent = mapping[nodeId]?.parent ?? null;
    nodeId = parent ?? undefined;
  }

  return pathIds.reverse();
}

function parseConversationToRawThread(conv: ExportConversation): RawThread | null {
  const mapping = conv.mapping || {};
  const title = (conv.title || "Untitled").toString().trim();
  const thread_uid = (conv.id || "").toString().trim() || `chatgpt-${uuidv4()}`;

  const created_at = isoFromSeconds(conv.create_time);
  const last_active_at = isoFromSeconds(conv.update_time);

  const nodePath = buildLinearPath(mapping, conv.current_node);

  const messages: RawMessage[] = [];
  for (const nodeId of nodePath) {
    const node = mapping[nodeId];
    const msg = node?.message ?? null;
    if (!msg) continue;

    const role = normalizeRole(msg.author?.role);
    const text = extractTextFromContent(msg.content);
    if (!text) continue;
    if (role === "system" && text.length < 5) continue;

    messages.push({ role, text });
  }

  // Fallback: scan all messages sorted by create_time
  if (messages.length === 0) {
    const all = Object.values(mapping)
      .map((n) => n?.message)
      .filter(Boolean) as NonNullable<ExportConversation["mapping"]>[string]["message"][];

    const sorted = all.sort((a, b) => (a?.create_time || 0) - (b?.create_time || 0));
    for (const m of sorted) {
      const role = normalizeRole(m?.author?.role);
      const text = extractTextFromContent(m?.content);
      if (!text) continue;
      if (role === "system" && text.length < 5) continue;
      messages.push({ role, text });
    }
  }

  if (messages.length === 0) return null;

  return {
    thread_uid,
    title,
    created_at,
    last_active_at,
    messages,
  };
}

function resolveZipPath(zipPathArg: string): string {
  const arg = zipPathArg.trim();

  if (path.isAbsolute(arg) && fs.existsSync(arg)) return arg;

  const repoCandidate = path.join(repoRoot(), arg);
  if (fs.existsSync(repoCandidate)) return repoCandidate;

  const cwdCandidate = path.resolve(process.cwd(), arg);
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;

  throw new Error(`Zip not found: ${zipPathArg}\nTried:\n- ${repoCandidate}\n- ${cwdCandidate}`);
}

async function extractZipToRunDir(zipFilePath: string, runId: string): Promise<string> {
  const runsRoot = path.join(cacheDir(), "runs");
  const runDir = path.join(runsRoot, runId);

  await fsp.mkdir(runDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(zipFilePath)
      .pipe(unzipper.Extract({ path: runDir }))
      .on("close", () => resolve())
      .on("error", (err: any) => reject(err));
  });

  return runDir;
}

async function readJsonFromRunDir(runDir: string, filename: string): Promise<any | null> {
  try {
    const filePath = path.join(runDir, filename);
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function importZip(
  zipPathArg: string
): Promise<{ runId: string; zipPath: string; threadCount: number }> {
  const zipPath = resolveZipPath(zipPathArg);
  const runId = uuidv4();

  await fsp.mkdir(cacheDir(), { recursive: true });

  const runDir = await extractZipToRunDir(zipPath, runId);

  // Prefer structured JSON
  const conversationsJson = await readJsonFromRunDir(runDir, "conversations.json");

  if (!Array.isArray(conversationsJson)) {
    throw new Error(
      `Expected conversations.json (array) in export, but did not find it or it was not an array.\nRunDir: ${runDir}`
    );
  }

  const threads: RawThread[] = [];
  for (const c of conversationsJson as ExportConversation[]) {
    const t = parseConversationToRawThread(c);
    if (t) threads.push(t);
  }

  await fsp.mkdir(path.dirname(rawThreadsPath()), { recursive: true });
  await fsp.writeFile(rawThreadsPath(), JSON.stringify(threads, null, 2), "utf8");

  console.log(`Imported zip. runId=${runId} zip=${zipPath}`);
  console.log(`Wrote ${threads.length} threads to ${rawThreadsPath()}`);

  return { runId, zipPath, threadCount: threads.length };
}
