#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

const suggestionsPath = arg(
  "--suggestions",
  "analytics/_current/triage/triage_suggestions.jsonl"
);
const threadsDir = arg("--threads", "thread-vault/threads");
const outPatch = arg(
  "--outPatch",
  "thread-vault/patches/route_suggestions.patch"
);
const minConf = Number(arg("--minConfidence", "0.75"));

if (!fs.existsSync(suggestionsPath)) {
  console.error("Missing suggestions:", suggestionsPath);
  process.exit(1);
}
if (!fs.existsSync(threadsDir)) {
  console.error("Missing threads dir:", threadsDir);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPatch), { recursive: true });

function parseFrontMatter(md) {
  const m = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!m) return { fm: {}, body: md, rawFm: null };
  const raw = m[1];
  const body = md.slice(m[0].length);
  const fm = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    fm[k] = v;
  }
  return { fm, body, rawFm: raw };
}

function rebuildFrontMatter(md, updates) {
  const m = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  const body = m ? md.slice(m[0].length) : md;
  const lines = [];
  lines.push("---");
  // keep minimal stable ordering
  const keys = Object.keys(updates);
  for (const k of keys) {
    const v = updates[k];
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(
        `${k}: [${v.map((x) => JSON.stringify(String(x))).join(", ")}]`
      );
    } else {
      lines.push(
        `${k}: ${typeof v === "string" ? JSON.stringify(v) : String(v)}`
      );
    }
  }
  lines.push("---");
  lines.push("");
  return lines.join("\n") + body.replace(/^\s*\r?\n/, "");
}

function readJsonl(p) {
  const raw = fs.readFileSync(p, "utf8");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function applySuggestionToMd(md, s) {
  // Only touch a few fields (safe + reversible)
  const updates = {
    thread_uid: s.thread_uid,
    title: undefined, // leave title alone
    domain: s.domain,
    apps: s.apps || [],
    tags: s.tags || [],
    // router fields live in nested yaml in your pipeline; we store minimal simple fields here
    primary_home_file: s.primary_home_file || "",
    router_confidence: Number(s.confidence ?? 0).toFixed(2),
    router_reason: s.reason || "",
  };
  return rebuildFrontMatter(md, updates);
}

const suggestions = readJsonl(suggestionsPath)
  .filter((s) => typeof s.confidence === "number" && s.confidence >= minConf)
  .filter((s) => s && s.thread_uid);

let patch = "";

for (const s of suggestions) {
  const fileRel = path.join("thread-vault", "threads", `${s.thread_uid}.md`);
  const fileAbs = path.join(process.cwd(), fileRel);
  if (!fs.existsSync(fileAbs)) continue;

  const before = fs.readFileSync(fileAbs, "utf8");
  const after = applySuggestionToMd(before, s);

  if (before === after) continue;

  // create temp files and diff -u to make a patch
  const tmpA = path.join("/tmp", `before_${s.thread_uid}.md`);
  const tmpB = path.join("/tmp", `after_${s.thread_uid}.md`);
  fs.writeFileSync(tmpA, before, "utf8");
  fs.writeFileSync(tmpB, after, "utf8");

  try {
    const d = execFileSync("diff", ["-u", tmpA, tmpB], { encoding: "utf8" });
    // rewrite headers to repo-relative paths (git-apply friendly)
    const normalized = d
      .replace(/^--- .*\n/, `--- a/${fileRel}\n`)
      .replace(/^\+\+\+ .*\n/, `+++ b/${fileRel}\n`);
    patch += normalized + "\n";
  } catch (e) {
    // diff exits 1 when differences exist; output is in stdout
    const out = e.stdout?.toString?.() || "";
    const normalized = out
      .replace(/^--- .*\n/, `--- a/${fileRel}\n`)
      .replace(/^\+\+\+ .*\n/, `+++ b/${fileRel}\n`);
    patch += normalized + "\n";
  }
}

fs.writeFileSync(outPatch, patch, "utf8");
console.log("Wrote patch:", outPatch);
console.log("suggestions_used:", suggestions.length);
