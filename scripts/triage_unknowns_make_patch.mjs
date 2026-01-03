#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";

// Resolve js-yaml from apps/indexer-cli/node_modules
const requireFromIndexer = createRequire(
  new URL("../apps/indexer-cli/dist/index.js", import.meta.url)
);
const yaml = requireFromIndexer("js-yaml");

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}
function flag(name) {
  return process.argv.includes(name);
}

const suggestionsPath = arg("--suggestions");
const queuePath = arg("--queue"); // NEW: optional queue for validation
const threadsDir = arg("--threads", "thread-vault/threads");
const outPatch = arg("--outPatch"); // Now required to be explicit or we compute it
const minConf = Number(arg("--minConfidence", "0.75"));
const forceFlag = flag("--force"); // NEW: bypass validation checks

if (!suggestionsPath) {
  console.error("Missing --suggestions <file.jsonl>");
  process.exit(1);
}
if (!fs.existsSync(suggestionsPath)) {
  console.error("Missing suggestions:", suggestionsPath);
  process.exit(1);
}
if (!fs.existsSync(threadsDir)) {
  console.error("Missing threads dir:", threadsDir);
  process.exit(1);
}

// Determine batch ID from suggestions filename
const batchIdMatch = suggestionsPath.match(/triage_suggestions_(\d+)/);
const batchId = batchIdMatch ? batchIdMatch[1] : "001";

// Compute default patch path with batch ID and threshold
const defaultPatchDir = "thread-vault/patches";
const threshStr = String(Math.round(minConf * 100)).padStart(3, "0");
const defaultPatchName = `route_suggestions_${batchId}_${threshStr}.safe.patch`;
const finalOutPatch = outPatch || path.join(defaultPatchDir, defaultPatchName);

fs.mkdirSync(path.dirname(finalOutPatch), { recursive: true });

// GUARDRAIL 1: Validate suggestions match queue if queue provided
let queueUids = new Set();
if (queuePath) {
  if (!fs.existsSync(queuePath)) {
    console.error("Queue file not found:", queuePath);
    process.exit(1);
  }
  const queueData = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  const queueArray = Array.isArray(queueData)
    ? queueData
    : queueData.items || queueData.threads || queueData.queue || [];
  queueUids = new Set(
    queueArray
      .map((x) => x.thread_uid || x.uid || x.id || null)
      .filter(Boolean)
  );
}

function readJsonl(p) {
  return fs
    .readFileSync(p, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function splitFrontMatter(md) {
  const m = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!m) return { meta: {}, body: md };
  const raw = m[1];
  let meta = {};
  try {
    const loaded = yaml.load(raw);
    if (loaded && typeof loaded === "object") meta = loaded;
  } catch {}
  const body = md.slice(m[0].length);
  return { meta, body };
}

function dumpFrontMatter(meta) {
  const y = yaml.dump(meta, { noRefs: true, lineWidth: 120 }).trimEnd();
  return `---\n${y}\n---\n\n`;
}

function sameArray(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

// Idempotent: ignore reason/at-only changes.
// We only re-write when domain/apps/tags/conf/home materially change.
function applySuggestion(md, s) {
  const { meta, body } = splitFrontMatter(md);

  const desiredDomain = s.domain;
  const desiredApps = Array.isArray(s.apps) ? s.apps : (Array.isArray(meta.apps) ? meta.apps : []);
  const desiredTags = Array.isArray(s.tags) ? s.tags : (Array.isArray(meta.tags) ? meta.tags : []);
  const desiredConf = typeof s.confidence === "number" ? s.confidence : null;
  const desiredHome = typeof s.primary_home_file === "string" ? s.primary_home_file : "";
  const desiredReason = typeof s.reason === "string" ? s.reason : "";

  const existingTriage = meta.triage && typeof meta.triage === "object" ? meta.triage : null;

  const alreadySame =
    meta.domain === desiredDomain &&
    sameArray(Array.isArray(meta.apps) ? meta.apps : [], desiredApps) &&
    sameArray(Array.isArray(meta.tags) ? meta.tags : [], desiredTags) &&
    existingTriage &&
    existingTriage.source === "llm_triage" &&
    (existingTriage.confidence ?? null) == desiredConf &&
    String(existingTriage.primary_home_file ?? "") === desiredHome;

  if (alreadySame) return md;

  meta.domain = desiredDomain;
  meta.apps = desiredApps;
  meta.tags = desiredTags;

  meta.triage = {
    source: "llm_triage",
    confidence: desiredConf,
    reason: desiredReason,
    primary_home_file: desiredHome,
    at: new Date().toISOString(),
  };

  return dumpFrontMatter(meta) + body.replace(/^\s*\r?\n/, "");
}

const suggestions = readJsonl(suggestionsPath)
  .filter((s) => s && s.thread_uid)
  .filter((s) => typeof s.confidence === "number" && s.confidence >= minConf);

// GUARDRAIL 1 (continued): Check ok_matches
let okMatches = 0;
if (queueUids.size > 0) {
  for (const s of suggestions) {
    if (queueUids.has(s.thread_uid)) {
      okMatches++;
    }
  }
  
  if (okMatches === 0 && !forceFlag) {
    console.error("❌ GUARDRAIL FAILURE: ok_matches = 0");
    console.error("");
    console.error("Your suggestions thread_uid values do NOT match any queue thread_uid.");
    console.error("This means the LLM may have invented IDs or you're using the wrong queue.");
    console.error("");
    console.error("Suggestions found:", suggestions.length);
    console.error("Queue entries:", queueUids.size);
    console.error("Matching IDs:", okMatches);
    console.error("");
    console.error("DO NOT PROCEED. Fix your suggestions file or use --force to bypass.");
    process.exit(1);
  }
  
  console.log(`✓ ID Validation: ${okMatches}/${suggestions.length} suggestions match queue`);
}

let patch = "";
let changed = 0;

for (const s of suggestions) {
  const uid = String(s.thread_uid);
  const fileRel = path.join("thread-vault", "threads", `${uid}.md`);
  const fileAbs = path.join(process.cwd(), fileRel);
  if (!fs.existsSync(fileAbs)) continue;

  const before = fs.readFileSync(fileAbs, "utf8");
  const after = applySuggestion(before, s);
  if (before === after) continue;

  changed++;

  const tmpA = path.join("/tmp", `before_${uid}.md`);
  const tmpB = path.join("/tmp", `after_${uid}.md`);
  fs.writeFileSync(tmpA, before, "utf8");
  fs.writeFileSync(tmpB, after, "utf8");

  let d = "";
  try {
    d = execFileSync(
      "diff",
      ["-u", "--label", `a/${fileRel}`, "--label", `b/${fileRel}`, tmpA, tmpB],
      { encoding: "utf8" }
    );
  } catch (e) {
    // diff exits 1 when differences exist; stdout contains the patch
    d = e && e.stdout ? e.stdout.toString() : "";
  }
  patch += d + "\n";
}

// GUARDRAIL 2: Refuse to write 0-byte patches
const patchBytes = Buffer.byteLength(patch, "utf8");
if (patchBytes === 0 && !forceFlag) {
  console.error("❌ GUARDRAIL FAILURE: patch is empty (0 bytes)");
  console.error("");
  console.error("No changes detected. This could mean:");
  console.error("- All suggestions already applied (idempotent check passed)");
  console.error("- Confidence threshold too high");
  console.error("- Suggestions don't match any existing threads");
  console.error("");
  console.error("Refusing to write empty patch. Use --force to bypass.");
  process.exit(1);
}

// Write patch
fs.writeFileSync(finalOutPatch, patch, "utf8");

// GUARDRAIL 4: Write patch report
const reportPath = finalOutPatch.replace(/\.patch$/, ".report.json");
const report = {
  timestamp: new Date().toISOString(),
  batch_id: batchId,
  suggestions_file: suggestionsPath,
  queue_file: queuePath || null,
  suggestions_lines: suggestions.length,
  ok_matches: queueUids.size > 0 ? okMatches : null,
  min_confidence: minConf,
  files_changed: changed,
  patch_path: finalOutPatch,
  patch_bytes: patchBytes,
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log("✅ Patch generated successfully");
console.log("Wrote patch:", finalOutPatch);
console.log("Wrote report:", reportPath);
console.log("suggestions_used:", suggestions.length);
console.log("files_changed:", changed);
console.log("patch_bytes:", patchBytes);
