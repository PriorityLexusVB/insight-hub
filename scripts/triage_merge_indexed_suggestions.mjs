#!/usr/bin/env node
// scripts/triage_merge_indexed_suggestions.mjs
// Merges indexed suggestions (with batch_index) back to thread_uid using the map.
//
// Usage:
//   node scripts/triage_merge_indexed_suggestions.mjs \
//     --suggestions analytics/_current/triage/triage_suggestions_001_indexed.jsonl \
//     --map analytics/_current/triage/batch_index_map_001.json \
//     --out analytics/_current/triage/triage_suggestions_001.jsonl

import fs from "fs";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

const suggestionsPath = arg("--suggestions");
const mapPath = arg("--map");
const outPath = arg("--out");

if (!suggestionsPath || !mapPath || !outPath) {
  console.error("Usage: node scripts/triage_merge_indexed_suggestions.mjs \\");
  console.error("  --suggestions <indexed_suggestions.jsonl> \\");
  console.error("  --map <batch_index_map.json> \\");
  console.error("  --out <output_suggestions.jsonl>");
  process.exit(1);
}

if (!fs.existsSync(suggestionsPath)) {
  console.error("Suggestions file not found:", suggestionsPath);
  process.exit(1);
}
if (!fs.existsSync(mapPath)) {
  console.error("Map file not found:", mapPath);
  process.exit(1);
}

// Read map
const mapping = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const indexToUid = {};
for (const item of mapping) {
  if (item.batch_index && item.thread_uid) {
    indexToUid[item.batch_index] = item.thread_uid;
  }
}

// Read suggestions
const suggestions = fs
  .readFileSync(suggestionsPath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

// Merge: replace batch_index with thread_uid
const merged = [];
let mapped = 0;
let unmapped = 0;

for (const s of suggestions) {
  if (s.batch_index) {
    const uid = indexToUid[s.batch_index];
    if (uid) {
      merged.push({
        ...s,
        thread_uid: uid,
        batch_index: undefined, // Remove batch_index
      });
      mapped++;
    } else {
      console.warn("WARNING: No mapping for batch_index:", s.batch_index);
      unmapped++;
    }
  } else if (s.thread_uid) {
    // Already has thread_uid, pass through
    merged.push(s);
    mapped++;
  } else {
    console.warn("WARNING: Suggestion has no batch_index or thread_uid:", s);
    unmapped++;
  }
}

// Write output as JSONL
const lines = merged.map((obj) => {
  // Remove undefined keys
  const clean = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      clean[key] = obj[key];
    }
  }
  return JSON.stringify(clean);
});

fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

console.log("Merged suggestions:", outPath);
console.log("Mapped:", mapped);
console.log("Unmapped:", unmapped);
console.log("Total output:", merged.length);
