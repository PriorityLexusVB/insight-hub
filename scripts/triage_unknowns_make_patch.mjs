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

const suggestionsPath = arg("--suggestions");
const threadsDir = arg("--threads", "thread-vault/threads");
const outPatch = arg("--outPatch", "thread-vault/patches/route_suggestions.patch");
const minConf = Number(arg("--minConfidence", "0.75"));

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

fs.mkdirSync(path.dirname(outPatch), { recursive: true });

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

fs.writeFileSync(outPatch, patch, "utf8");
console.log("Wrote patch:", outPatch);
console.log("suggestions_used:", suggestions.length);
console.log("files_changed:", changed);
console.log("patch_bytes:", Buffer.byteLength(patch, "utf8"));
