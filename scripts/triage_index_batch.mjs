#!/usr/bin/env node
// scripts/triage_index_batch.mjs
// Creates an indexed version of a triage batch for ID-proof LLM workflow.
// Adds batch_index (1, 2, 3...) to each thread and writes a mapping file.
//
// Usage:
//   node scripts/triage_index_batch.mjs \
//     --queue analytics/_current/triage/unknown_queue_001.json \
//     --out analytics/_current/triage/unknown_queue_001_indexed.json \
//     --map analytics/_current/triage/batch_index_map_001.json \
//     --batch analytics/_current/triage/triage_batch_001_indexed.md

import fs from "fs";
import path from "path";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

const queuePath = arg("--queue");
const outPath = arg("--out");
const mapPath = arg("--map");
const batchPath = arg("--batch");

if (!queuePath) {
  console.error("Missing --queue <unknown_queue_XXX.json>");
  process.exit(1);
}
if (!fs.existsSync(queuePath)) {
  console.error("Queue file not found:", queuePath);
  process.exit(1);
}

// Determine defaults if not provided
const batchIdMatch = queuePath.match(/unknown_queue_(\d+)\.json/);
const batchId = batchIdMatch ? batchIdMatch[1] : "001";
const outDir = path.dirname(queuePath);

const finalOutPath = outPath || path.join(outDir, `unknown_queue_${batchId}_indexed.json`);
const finalMapPath = mapPath || path.join(outDir, `batch_index_map_${batchId}.json`);
const finalBatchPath = batchPath || path.join(outDir, `triage_batch_${batchId}_indexed.md`);

// Read queue
const queueData = JSON.parse(fs.readFileSync(queuePath, "utf8"));
const queue = Array.isArray(queueData) ? queueData : queueData.items || queueData.threads || queueData.queue || [];

if (queue.length === 0) {
  console.error("Queue is empty:", queuePath);
  process.exit(1);
}

// Add batch_index to each item
const indexed = queue.map((item, idx) => ({
  ...item,
  batch_index: idx + 1,
}));

// Create mapping: batch_index -> thread_uid
const mapping = indexed.map((item) => ({
  batch_index: item.batch_index,
  thread_uid: item.thread_uid || item.uid || item.id || "",
}));

// Write indexed queue
fs.writeFileSync(finalOutPath, JSON.stringify(indexed, null, 2), "utf8");

// Write mapping
fs.writeFileSync(finalMapPath, JSON.stringify(mapping, null, 2), "utf8");

// Generate indexed batch markdown if threads available
const threadsDir = "thread-vault/threads";
if (fs.existsSync(threadsDir)) {
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

  function stripFrontMatter(md) {
    return md.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, "");
  }
  function stripCodeFences(md) {
    return md.replace(/```[\s\S]*?```/g, "");
  }
  function snippet(md, n = 2000) {
    const s = stripCodeFences(stripFrontMatter(md)).trim().replace(/\s+/g, " ");
    return s.slice(0, n);
  }

  const lines = [];
  lines.push(`# Triage Batch ${batchId} (Indexed) — Unknown/Low-Confidence Threads`);
  lines.push("");
  lines.push("## Output contract (STRICT)");
  lines.push("");
  lines.push(
    "Return JSONL only. One JSON object per line. No markdown. No commentary."
  );
  lines.push("Required keys:");
  lines.push("- batch_index (number 1, 2, 3...) <-- USE THIS INSTEAD OF thread_uid");
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
    "- Use batch_index, NOT thread_uid. The system will map batch_index back to thread_uid."
  );
  lines.push(
    "- If unsure, set domain/work_type to unknown and confidence <= 0.60."
  );
  lines.push('- Do NOT invent paths. If no clear home, primary_home_file = "".');
  lines.push("");

  for (const item of indexed) {
    const uid = item.thread_uid || item.uid || item.id || "";
    const p = path.join(threadsDir, `${uid}.md`);
    let md = "";
    try {
      md = fs.readFileSync(p, "utf8");
    } catch {
      md = "";
    }

    lines.push("---");
    lines.push(`batch_index: ${item.batch_index}`);
    lines.push(`title: ${item.title || ""}`);
    lines.push(`current_domain: ${item.domain || "unknown"}`);
    lines.push(`current_work_type: ${item.work_type || "unknown"}`);
    lines.push(`router_confidence: ${item.router_confidence ?? ""}`);
    lines.push(`primary_home_file: ${item.primary_home_file || ""}`);
    lines.push(`load_score: ${Number(item.load_score || 0).toFixed(2)}`);
    lines.push(`cwid: ${Number(item.cwid || 0).toFixed(2)}`);
    lines.push(`snippet: ${snippet(md)}`);
    lines.push("");
  }

  fs.writeFileSync(finalBatchPath, lines.join("\n"), "utf8");
  console.log("Wrote indexed batch:", finalBatchPath);
}

console.log("Wrote indexed queue:", finalOutPath);
console.log("Wrote index map:", finalMapPath);
console.log("Items indexed:", indexed.length);
