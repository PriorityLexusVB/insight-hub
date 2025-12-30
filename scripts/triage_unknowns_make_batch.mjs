#!/usr/bin/env node
import fs from "fs";
import path from "path";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}
function flag(name) {
  return process.argv.includes(name);
}

const inChatIndex = arg("--in", "analytics/_current/chat_index.json");
const threadsDir = arg("--threads", "thread-vault/threads");
const outDir = arg("--out", "analytics/_current/triage");
const limit = Number(arg("--limit", "150"));
const confMax = Number(arg("--confMax", "0.69")); // triage low-confidence or unknown
const includeDomainUnknownOnly = flag("--unknownOnly"); // optional

if (!fs.existsSync(inChatIndex)) {
  console.error("Missing chat_index:", inChatIndex);
  process.exit(1);
}
if (!fs.existsSync(threadsDir)) {
  console.error("Missing threads dir:", threadsDir);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const rows = JSON.parse(fs.readFileSync(inChatIndex, "utf8"));
const pick = rows
  .filter((r) => {
    const conf =
      typeof r.router_confidence === "number" ? r.router_confidence : null;
    const lowConf = conf !== null && conf <= confMax;
    const isUnknown = (r.domain || "unknown") === "unknown";
    if (includeDomainUnknownOnly) return isUnknown;
    return isUnknown || lowConf;
  })
  .sort((a, b) => (b.load_score || 0) - (a.load_score || 0))
  .slice(0, limit);

function stripFrontMatter(md) {
  return md.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, "");
}
function stripCodeFences(md) {
  return md.replace(/```[\s\S]*?```/g, "");
}
function snippet(md, n = 1200) {
  const s = stripCodeFences(stripFrontMatter(md)).trim().replace(/\s+/g, " ");
  return s.slice(0, n);
}

const queuePath = path.join(outDir, "unknown_queue.json");
const batchPath = path.join(outDir, "triage_batch_001.md");

fs.writeFileSync(queuePath, JSON.stringify(pick, null, 2), "utf8");

const allowedDomains = [
  "dealership_ops",
  "infra_agents",
  "research",
  "personal",
  "unknown",
];
const allowedWork = [
  "ops",
  "technical",
  "leadership",
  "strategy",
  "comms",
  "creative",
  "personal",
  "entertainment",
  "unknown",
];

const lines = [];
lines.push("# Triage Batch 001 — Unknown/Low-Confidence Threads");
lines.push("");
lines.push("## Output contract (STRICT)");
lines.push("");
lines.push(
  "Return **JSONL**. One JSON object per line, no markdown, no commentary."
);
lines.push("Required keys:");
lines.push("- thread_uid (string)");
lines.push("- domain (one of: " + allowedDomains.join(", ") + ")");
lines.push("- work_type (one of: " + allowedWork.join(", ") + ")");
lines.push(
  "- primary_home_file (string path like docs/.../INDEX.md OR empty string)"
);
lines.push("- tags (array of strings)");
lines.push("- apps (array of strings)");
lines.push("- confidence (number 0.00–1.00)");
lines.push("- reason (short string)");
lines.push("");
lines.push("Rules:");
lines.push(
  "- If unsure, set domain/work_type to unknown and confidence <= 0.60."
);
lines.push('- Do NOT invent paths. If no clear home, primary_home_file = "".');
lines.push("");

for (const r of pick) {
  const uid = r.thread_uid;
  const p = path.join(threadsDir, `${uid}.md`);
  let md = "";
  try {
    md = fs.readFileSync(p, "utf8");
  } catch {
    md = "";
  }

  lines.push(`---`);
  lines.push(`thread_uid: ${uid}`);
  lines.push(`title: ${r.title || ""}`);
  lines.push(`current_domain: ${r.domain || "unknown"}`);
  lines.push(`current_work_type: ${r.work_type || "unknown"}`);
  lines.push(`router_confidence: ${r.router_confidence ?? ""}`);
  lines.push(`primary_home_file: ${r.primary_home_file || ""}`);
  lines.push(`load_score: ${Number(r.load_score || 0).toFixed(2)}`);
  lines.push(`cwid: ${Number(r.cwid || 0).toFixed(2)}`);
  lines.push(`snippet: ${snippet(md)}`);
  lines.push("");
}

fs.writeFileSync(batchPath, lines.join("\n"), "utf8");

console.log("Wrote:", queuePath);
console.log("Wrote:", batchPath);
console.log("triage_count:", pick.length);
