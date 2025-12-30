#!/usr/bin/env node
// scripts/build_message_index.mjs
// Build a message-level index from a ChatGPT export conversations.json
// and attach categories from analytics/*/chat_index.json

import fs from "fs";
import path from "path";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}
function hasFlag(name) {
  return process.argv.includes(name);
}

const conversationsPath = arg("--conversations");
let chatIndexPath = arg("--chatIndex");
const outDir = arg("--out", "analytics/message_index");
const mode = arg("--mode", "active"); // active|all
const yearFilter = arg("--year", "");
const includeText = hasFlag("--include-text");

if (hasFlag("--help") || !conversationsPath) {
  console.log(`Usage:
  node scripts/build_message_index.mjs --conversations <path> [--chatIndex <path>] [--out <dir>] [--mode active|all] [--year 2025] [--include-text]`);
  process.exit(conversationsPath ? 0 : 1);
}

const yearNum = yearFilter ? Number(yearFilter) : null;

const isoYear = (sec) =>
  sec && Number.isFinite(sec) ? new Date(sec * 1000).getUTCFullYear() : null;
const isoDate = (sec) =>
  sec && Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : null;

function extractText(msg) {
  const parts = msg?.content?.parts;
  const text = msg?.content?.text;
  let s = "";
  if (Array.isArray(parts))
    for (const p of parts)
      if (typeof p === "string") s += p;
      else if (typeof text === "string") s = text;

  const trimmed = String(s ?? "").trim();
  return {
    has_text: trimmed.length > 0,
    text_len: trimmed.length,
    preview: trimmed.slice(0, 280),
    full: trimmed,
  };
}

function isVisuallyHidden(msg) {
  return !!msg?.metadata?.is_visually_hidden;
}
function isRoleAllowed(role) {
  return role === "user" || role === "assistant";
}

function newestChatIndex() {
  const base = "analytics";
  if (!fs.existsSync(base)) return null;
  const dirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(base, d.name));
  const hits = [];
  for (const d of dirs) {
    const p = path.join(d, "chat_index.json");
    if (fs.existsSync(p)) hits.push(p);
  }
  hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (fs.existsSync("analytics/_dev/chat_index.json"))
    return "analytics/_dev/chat_index.json";
  return hits[0] || null;
}

if (!chatIndexPath) {
  chatIndexPath = newestChatIndex();
  if (!chatIndexPath) {
    console.error(
      "Error: --chatIndex not provided and no analytics/*/chat_index.json found."
    );
    process.exit(1);
  }
}

function loadChatIndexMap(p) {
  const rows = JSON.parse(fs.readFileSync(p, "utf8"));
  const m = new Map();
  for (const r of rows) m.set(String(r.thread_uid), r);
  return m;
}

function iterActivePath(mapping, currentNode) {
  const out = [];
  if (!currentNode || !mapping?.[currentNode]) return out;
  const seen = new Set();
  let nodeId = currentNode;
  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    out.push(nodeId);
    nodeId = mapping?.[nodeId]?.parent;
  }
  return out;
}

const chatMap = loadChatIndexMap(chatIndexPath);

console.log("Using chat_index:", chatIndexPath);
console.log("Loading conversations:", conversationsPath);

const parsed = JSON.parse(fs.readFileSync(conversationsPath, "utf8"));
const convs = Array.isArray(parsed) ? parsed : parsed?.conversations ?? [];
console.log("Conversations:", convs.length);

fs.mkdirSync(outDir, { recursive: true });

const suffix = `${mode}${yearFilter ? "_" + yearFilter : ""}`;
const outJsonl = path.join(outDir, `message_index_${suffix}.jsonl`);
const outSummary = path.join(outDir, `message_index_${suffix}_summary.json`);

const w = fs.createWriteStream(outJsonl, { encoding: "utf8" });

const summary = {
  generated_at: new Date().toISOString(),
  conversations_total: convs.length,
  mode,
  yearFilter: yearFilter || null,
  messages_emitted: 0,
  counts_by_year: {},
  counts_by_role: {},
  counts_by_content_type: {},
  counts_by_domain: {},
  counts_by_work_type: {},
};

function bump(mapObj, key) {
  const k = key || "unknown";
  mapObj[k] = (mapObj[k] || 0) + 1;
}
function emitMessage(rec) {
  w.write(JSON.stringify(rec) + "\n");
  summary.messages_emitted++;
  bump(summary.counts_by_year, String(rec.year ?? "unknown"));
  bump(summary.counts_by_role, rec.role);
  bump(summary.counts_by_content_type, rec.content_type);
  bump(summary.counts_by_domain, rec.domain);
  bump(summary.counts_by_work_type, rec.work_type);
}

for (const c of convs) {
  const convId = String(c?.id ?? c?.conversation_id ?? "");
  const mapping = c?.mapping || {};
  const currentNode = c?.current_node;

  const meta = chatMap.get(convId) || null;
  const domain = meta?.domain || "unknown";
  const work_type = meta?.work_type || "unknown";
  const is_work = meta?.is_work ?? null;
  const apps = meta?.apps ?? [];
  const tags = meta?.tags ?? [];
  const cluster_id = meta?.cluster_id || "";
  const primary_home_file = meta?.primary_home_file || "";

  const nodeIds =
    mode === "all"
      ? Object.keys(mapping)
      : iterActivePath(mapping, currentNode);

  for (const nodeId of nodeIds) {
    const msg = mapping?.[nodeId]?.message;
    if (!msg) continue;

    const role = msg?.author?.role;
    if (!isRoleAllowed(role)) continue;
    if (isVisuallyHidden(msg)) continue;

    const y = isoYear(msg.create_time);
    if (yearNum && y !== yearNum) continue;

    const content_type = msg?.content?.content_type || "text";
    const t = extractText(msg);

    const rec = {
      conversation_id: convId,
      node_id: nodeId,
      message_id: msg?.id ?? null,
      year: y,
      created_at: isoDate(msg.create_time),
      role,
      content_type,
      has_text: t.has_text,
      text_len: t.text_len,
      preview: t.preview,
      domain,
      work_type,
      is_work,
      apps,
      tags,
      cluster_id,
      primary_home_file,
    };

    if (includeText) rec.text = t.full;
    emitMessage(rec);
  }
}

w.end();
fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), "utf8");

console.log("Wrote:", outJsonl);
console.log("Wrote:", outSummary);
console.log("messages_emitted:", summary.messages_emitted);
