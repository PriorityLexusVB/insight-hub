#!/usr/bin/env node
/**
 * FULL REPLACEMENT FILE
 * scripts/notebooklm_upload_plan.mjs (v4)
 *
 * Reads:
 *  - notebooklm_packets/tables/tools.md
 *  - notebooklm_packets/INDEX.md
 *  - analytics/_current/chat_index.json
 *
 * Fixes your schema:
 *  - chat_index.json is a numeric-key object: { "0": {...}, "1": {...}, ... }
 *  - We auto-detect and use Object.values(obj) as records.
 *
 * Produces:
 *  1) Ranked TOP TOOL PACKETS (10–20) by frequency + load (inferred via keywords)
 *  2) Notebook structure (6 notebooks) <= 50 sources each (NO empty notebooks)
 *  3) Exact packet files per notebook
 *  4) Missing keyword suggestions (high-frequency tokens not covered by tools.md keywords)
 *
 * Optional:
 *  --materialize <dir>  create folders for NotebookLM drag-drop upload
 *  --copy               copy files rather than symlink
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
function exists(p) {
  return fs.existsSync(p);
}
function readText(p) {
  return fs.readFileSync(p, "utf8");
}
function writeText(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

function parseArgs(argv) {
  const args = {
    top: 15,
    maxSources: 50,
    out: "",
    materialize: "",
    copy: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--top") args.top = Number(argv[++i]);
    else if (a === "--max-sources") args.maxSources = Number(argv[++i]);
    else if (a === "--out") args.out = String(argv[++i]);
    else if (a === "--materialize") args.materialize = String(argv[++i]);
    else if (a === "--copy") args.copy = true;
    else if (a === "-h" || a === "--help") {
      console.log(`
Usage:
  node scripts/notebooklm_upload_plan.mjs [options]

Options:
  --top <n>              top tool packets (10–20) [default: 15]
  --max-sources <n>      sources per notebook (<=50) [default: 50]
  --out <file.md>        write output to file
  --materialize <dir>    create folders for NotebookLM drag-drop upload
  --copy                 copy files instead of symlink (when materializing)
`);
      process.exit(0);
    }
  }
  args.top = Math.max(10, Math.min(20, args.top));
  args.maxSources = Math.max(1, Math.min(50, args.maxSources));
  return args;
}

function parseMarkdownTableFirst(md) {
  const lines = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++)
    if (lines[i].trim().startsWith("|")) {
      start = i;
      break;
    }
  if (start === -1) return { headers: [], rows: [] };

  const block = [];
  for (let i = start; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) break;
    block.push(lines[i]);
  }
  if (block.length < 2) return { headers: [], rows: [] };

  const splitRow = (row) =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((x) => x.trim());
  const headers = splitRow(block[0]);
  const align = block[1].trim();
  const isAlign = /^[\|\s:\-]+$/.test(align);
  const dataRows = isAlign ? block.slice(2) : block.slice(1);
  const rows = dataRows.filter(Boolean).map(splitRow);
  return { headers, rows };
}

function findCol(headers, needles) {
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    if (needles.some((n) => h.includes(n))) return i;
  }
  return -1;
}

function parseToolsMd(toolsMdText) {
  const { headers, rows } = parseMarkdownTableFirst(toolsMdText);
  if (!headers.length) throw new Error("tools.md: no markdown table found");

  const toolCol = findCol(headers, ["tool", "name"]);
  const catCol = findCol(headers, ["category", "group", "bucket", "area"]);
  const pktCol = findCol(headers, ["packet", "file", "path", "source"]);
  const kwCol = findCol(headers, ["keywords", "keyword", "alias", "synonym"]);
  if (toolCol === -1 || pktCol === -1)
    throw new Error(
      `tools.md: missing required columns. headers=${headers.join(", ")}`
    );

  const toolMap = new Map(); // tool -> {category, packets[], keywords[]}
  const allKeywords = new Set();

  for (const r of rows) {
    const tool = norm((r[toolCol] || "").trim());
    if (!tool) continue;

    const category = catCol !== -1 ? norm(r[catCol] || "") : "";
    const packets = String(r[pktCol] || "")
      .split(/[,;\n]+/g)
      .map((x) => x.trim())
      .filter(Boolean);
    const keywords =
      kwCol !== -1
        ? String(r[kwCol] || "")
            .split(/[,;\n]+/g)
            .map((x) => norm(x))
            .filter(Boolean)
        : [];

    for (const kw of keywords) allKeywords.add(kw);
    toolMap.set(tool, { tool, category, packets, keywords });
  }

  return { toolMap, allKeywords };
}

function extractPacketsFromIndex(indexText) {
  const out = new Set();
  const reFull = /(notebooklm_packets\/[A-Za-z0-9_\-./]+?\.md)/g;
  const reLink = /\(([^)]+?\.md)\)/g;
  let m;
  while ((m = reFull.exec(indexText))) out.add(m[1].trim());
  while ((m = reLink.exec(indexText))) {
    const p = m[1].trim();
    if (p.startsWith("notebooklm_packets/")) out.add(p);
    else if (p.endsWith(".md"))
      out.add("notebooklm_packets/" + p.replace(/^\.\//, ""));
  }
  return Array.from(out).sort();
}

function estimateLoad(obj) {
  if (!obj || typeof obj !== "object") return 1;
  const numericFields = [
    "tokens",
    "total_tokens",
    "word_count",
    "words",
    "chars",
    "messages",
    "message_count",
    "len",
    "length",
  ];
  for (const k of numericFields) {
    const v = obj[k];
    if (typeof v === "number" && v > 0) return v;
  }
  return 1;
}

function isNumericKeyObject(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const keys = Object.keys(o);
  if (keys.length < 50) return false;
  // check first 200 keys: must be numeric strings
  const sample = keys.slice(0, Math.min(200, keys.length));
  const numericCount = sample.filter((k) => /^\d+$/.test(k)).length;
  if (numericCount < sample.length * 0.95) return false;
  // value should look object-like
  const v0 = o[sample[0]];
  return v0 && typeof v0 === "object";
}

function pickRecords(chatIndexObj) {
  // Case 1: already an array
  if (
    Array.isArray(chatIndexObj) &&
    chatIndexObj.length &&
    typeof chatIndexObj[0] === "object"
  ) {
    return { key: "root_array", records: chatIndexObj };
  }

  // Case 2: common named arrays
  for (const k of ["threads", "items", "rows", "data"]) {
    const v = chatIndexObj?.[k];
    if (Array.isArray(v) && v.length && typeof v[0] === "object")
      return { key: k, records: v };
  }

  // Case 3: YOUR CASE: numeric-key object
  if (isNumericKeyObject(chatIndexObj)) {
    return {
      key: "numeric_key_object_values",
      records: Object.values(chatIndexObj).filter(
        (x) => x && typeof x === "object"
      ),
    };
  }

  // Case 4: largest top-level array of objects
  const arrays = Object.entries(chatIndexObj || {})
    .filter(
      ([_, v]) => Array.isArray(v) && v.length && typeof v[0] === "object"
    )
    .sort((a, b) => b[1].length - a[1].length);
  if (arrays.length) return { key: arrays[0][0], records: arrays[0][1] };

  return { key: "none", records: [] };
}

function collectStringsDeep(obj, maxChars = 250000) {
  const out = [];
  let chars = 0;

  function pushStr(s) {
    if (!s) return;
    const t = String(s);
    if (!t) return;
    if (chars >= maxChars) return;
    out.push(t);
    chars += t.length + 1;
  }

  function walk(o, depth = 0) {
    if (chars >= maxChars) return;
    if (depth > 12) return;
    if (o == null) return;

    if (typeof o === "string") {
      pushStr(o);
      return;
    }
    if (typeof o === "number" || typeof o === "boolean") {
      return;
    }

    if (Array.isArray(o)) {
      for (const it of o) {
        walk(it, depth + 1);
        if (chars >= maxChars) break;
      }
      return;
    }

    if (typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        pushStr(k); // keys can carry signal
        walk(v, depth + 1); // values
        if (chars >= maxChars) break;
      }
    }
  }

  walk(obj, 0);
  return norm(out.join("\n"));
}

function inferToolsByKeywords(text, toolMap) {
  const hits = new Set();
  for (const [tool, row] of toolMap.entries()) {
    for (const kw of row.keywords || []) {
      if (!kw) continue;
      if (text.includes(kw)) {
        hits.add(tool);
        break;
      }
    }
  }
  return Array.from(hits);
}

function scoreTools(stats) {
  // score = count * (1 + log1p(avgLoad))
  const scores = new Map();
  for (const [tool, v] of stats.entries()) {
    const count = v.count || 0;
    const load = v.load || 0;
    if (!count) continue;
    const avg = load / count;
    scores.set(tool, count * (1 + Math.log1p(Math.max(0, avg))));
  }
  return scores;
}

function safeDirName(name) {
  return (
    name
      .replace(/[^\w\s\-./]/g, "")
      .replace(/\//g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "notebook"
  );
}

function materialize(notebooks, outDir, copyFiles) {
  fs.mkdirSync(outDir, { recursive: true });
  const missing = [];
  for (const nb of notebooks) {
    const nbDir = path.join(outDir, safeDirName(nb.name));
    fs.mkdirSync(nbDir, { recursive: true });
    for (const rel of nb.sources) {
      const src = path.join(process.cwd(), rel);
      if (!exists(src)) {
        missing.push(rel);
        continue;
      }
      let dst = path.join(nbDir, path.basename(rel));
      if (exists(dst)) {
        const ext = path.extname(dst);
        const base = path.basename(dst, ext);
        let k = 2;
        while (exists(path.join(nbDir, `${base}__${k}${ext}`))) k++;
        dst = path.join(nbDir, `${base}__${k}${ext}`);
      }
      try {
        copyFiles ? fs.copyFileSync(src, dst) : fs.symlinkSync(src, dst);
      } catch {
        fs.copyFileSync(src, dst);
      }
    }
  }
  return { missing: Array.from(new Set(missing)).sort() };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const toolsPath = path.join(
    process.cwd(),
    "notebooklm_packets/tables/tools.md"
  );
  const indexPath = path.join(process.cwd(), "notebooklm_packets/INDEX.md");
  const chatIndexPath = path.join(
    process.cwd(),
    "analytics/_current/chat_index.json"
  );

  const missingInputs = [];
  if (!exists(toolsPath))
    missingInputs.push("notebooklm_packets/tables/tools.md");
  if (!exists(indexPath)) missingInputs.push("notebooklm_packets/INDEX.md");
  if (!exists(chatIndexPath))
    missingInputs.push("analytics/_current/chat_index.json");
  if (missingInputs.length) {
    console.error("Missing required inputs:");
    missingInputs.forEach((m) => console.error(`- ${m}`));
    process.exit(2);
  }

  const { toolMap, allKeywords } = parseToolsMd(readText(toolsPath));
  const allPackets = extractPacketsFromIndex(readText(indexPath));
  const chatIndexObj = JSON.parse(readText(chatIndexPath));

  const { key: recordsKey, records } = pickRecords(chatIndexObj);

  const toolStats = new Map(); // tool -> {count, load}
  const tokenCounts = new Map(); // token -> count

  for (const rec of records) {
    const load = estimateLoad(rec);
    const text = collectStringsDeep(rec);

    for (const tok of text.match(/[a-z0-9_.:@/-]{3,}/g) || []) {
      const t = norm(tok);
      if (!t) continue;
      tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
    }

    const tools = inferToolsByKeywords(text, toolMap);
    for (const tool of new Set(tools)) {
      const cur = toolStats.get(tool) || { count: 0, load: 0 };
      cur.count += 1;
      cur.load += load;
      toolStats.set(tool, cur);
    }
  }

  const toolScores = scoreTools(toolStats);
  const rankedTools = Array.from(toolScores.entries()).sort(
    (a, b) => b[1] - a[1]
  );

  // ranked tool packets
  const rankedToolPackets = [];
  const seenPackets = new Set();
  for (const [tool, score] of rankedTools) {
    const row = toolMap.get(tool);
    for (const p of row?.packets || []) {
      if (!p || seenPackets.has(p)) continue;
      seenPackets.add(p);
      rankedToolPackets.push({ path: p, score, tool });
      if (rankedToolPackets.length >= args.top) break;
    }
    if (rankedToolPackets.length >= args.top) break;
  }

  // fill remaining with any tool packets
  if (rankedToolPackets.length < args.top) {
    const toolPktsAll = allPackets.filter((p) =>
      p.includes("notebooklm_packets/packets/tools/")
    );
    for (const p of toolPktsAll) {
      if (seenPackets.has(p)) continue;
      rankedToolPackets.push({ path: p, score: 0, tool: "unscored" });
      seenPackets.add(p);
      if (rankedToolPackets.length >= args.top) break;
    }
  }

  const topToolPacketPaths = rankedToolPackets.map((x) => x.path);

  // 6 notebooks, no empties
  const notebooks = [
    {
      name: "NotebookLM — Index + Tables",
      sources: [
        "notebooklm_packets/INDEX.md",
        "notebooklm_packets/tables/tools.md",
      ],
    },
    {
      name: "Insight Hub — Repo Packets",
      sources: allPackets.filter((p) =>
        p.includes("notebooklm_packets/packets/repo/")
      ),
    },
    { name: "Tools — Top (Ranked)", sources: topToolPacketPaths },
    {
      name: "Tools — Office Outputs",
      sources: allPackets.filter((p) =>
        ["docs_word_", "spreadsheets_", "slides_", "pdf_generation_"].some(
          (x) => p.includes(x)
        )
      ),
    },
    {
      name: "Tools — Engineering + Data",
      sources: allPackets.filter((p) =>
        [
          "github_repo_",
          "python_data_",
          "json_jsonl_",
          "pdf_reading_",
          "web_research_",
          "images_",
        ].some((x) => p.includes(x))
      ),
    },
    {
      name: "Tools — Integrations",
      sources: allPackets.filter((p) =>
        ["email_gmail_", "calendar_gcal_", "contacts_gcontacts_"].some((x) =>
          p.includes(x)
        )
      ),
    },
  ]
    .map((n) => ({
      name: n.name,
      sources: Array.from(new Set(n.sources))
        .filter(Boolean)
        .slice(0, args.maxSources),
    }))
    .filter((n) => n.sources.length);

  const missingPacketFiles = allPackets.filter(
    (p) => !exists(path.join(process.cwd(), p))
  );

  const missingKeywords = Array.from(tokenCounts.entries())
    .filter(([tok, c]) => c >= 8 && !allKeywords.has(tok))
    .filter(([tok]) => !tok.startsWith("http") && !tok.endsWith(".md"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60);

  // Debug summary: top tools by count
  const topToolsByCount = Array.from(toolStats.entries())
    .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
    .slice(0, 12)
    .map(([t, v]) => `- ${t}: count=${v.count}, load≈${Math.round(v.load)}`);

  const lines = [];
  lines.push(`# NOTEBOOKLM UPLOAD PLAN`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Records source: ${recordsKey} (records=${records.length})`);
  lines.push("");

  lines.push(`## 0) Tool signal sanity check (top tools by count)`);
  lines.push(
    topToolsByCount.length
      ? topToolsByCount.join("\n")
      : "- (no tool hits found)"
  );
  lines.push("");

  lines.push(
    `## 1) Ranked Top TOOL Packets (Top ${args.top}) — frequency + load`
  );
  lines.push("");
  rankedToolPackets.forEach((x, idx) =>
    lines.push(
      `${idx + 1}. \`${x.path}\` — score=${x.score.toFixed(2)} (tool=${x.tool})`
    )
  );
  lines.push("");

  lines.push(
    `## 2) Notebook Structure (${notebooks.length} notebooks, max ${args.maxSources} sources each)`
  );
  lines.push("");
  notebooks.forEach((nb) => {
    lines.push(`### ${nb.name} (${nb.sources.length} sources)`);
    nb.sources.forEach((src) => lines.push(`- \`${src}\``));
    lines.push("");
  });

  lines.push(
    `## 3) Missing tool/repo keywords to add (top unmatched tokens from chat_index records)`
  );
  lines.push("");
  if (!missingKeywords.length)
    lines.push(`- ✅ No obvious missing keywords detected above threshold.`);
  else
    missingKeywords.forEach(([tok, c]) =>
      lines.push(`- \`${tok}\` — occurrences=${c}`)
    );
  lines.push("");

  lines.push(`## 4) Integrity Checks`);
  lines.push("");
  if (!missingPacketFiles.length)
    lines.push(`- ✅ All packet files referenced in INDEX exist on disk.`);
  else {
    lines.push(
      `- ❌ Missing packet files referenced in INDEX (${missingPacketFiles.length}):`
    );
    missingPacketFiles.forEach((p) => lines.push(`  - \`${p}\``));
  }
  lines.push("");

  const outMd = lines.join("\n") + "\n";
  if (args.out) {
    writeText(path.join(process.cwd(), args.out), outMd);
    console.log(`✅ Wrote: ${args.out}`);
  } else process.stdout.write(outMd);

  if (args.materialize) {
    const outDir = path.join(process.cwd(), args.materialize);
    const report = materialize(notebooks, outDir, args.copy);
    writeText(
      path.join(outDir, "_materialize_report.json"),
      JSON.stringify(report, null, 2) + "\n"
    );
    console.log(`✅ Materialized folders under: ${args.materialize}`);
    if (report.missing.length)
      console.log(
        `⚠ Missing sources: ${report.missing.length} (see _materialize_report.json)`
      );
  }
}

main();
