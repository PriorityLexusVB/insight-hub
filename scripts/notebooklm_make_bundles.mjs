#!/usr/bin/env node
/**
 * Build NotebookLM bundle files from NOTEBOOKLM_UPLOAD_PLAN.md.
 * This prevents "source inflation" caused by bundling from materialized folders
 * that include duplicates across notebooks.
 *
 * Outputs: notebooklm_bundles/*.md
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PLAN = path.join(ROOT, "NOTEBOOKLM_UPLOAD_PLAN.md");
const OUT_DIR = path.join(ROOT, "notebooklm_bundles");

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function read(p) {
  return fs.readFileSync(p, "utf8");
}
function write(p, s) {
  mkdirp(path.dirname(p));
  fs.writeFileSync(p, s, "utf8");
}
function exists(p) {
  return fs.existsSync(p);
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function parsePlan(md) {
  // Finds sections like: ### Notebook Name (N sources) then list of - `path`
  const lines = md.split(/\r?\n/);
  const notebooks = [];
  let current = null;

  for (const ln of lines) {
    const h = ln.match(/^###\s+(.+?)\s+\(\d+\s+sources\)\s*$/);
    if (h) {
      if (current) notebooks.push(current);
      current = { name: h[1].trim(), sources: [] };
      continue;
    }
    const m = ln.match(/^\-\s+`([^`]+)`\s*$/);
    if (m && current) {
      current.sources.push(m[1].trim());
    }
  }
  if (current) notebooks.push(current);

  // Only include notebooks that actually have sources
  return notebooks.filter((n) => n.sources.length);
}

function bundleNotebook(nb) {
  const uniq = Array.from(new Set(nb.sources));
  const parts = [];
  parts.push(`# NotebookLM Bundle — ${nb.name}`);
  parts.push(`Generated: ${new Date().toISOString()}`);
  parts.push("");
  parts.push("## Included sources");
  for (const s of uniq) parts.push(`- ${s}`);
  parts.push("");
  parts.push("---");
  parts.push("");

  let included = 0;
  for (const rel of uniq) {
    const p = path.join(ROOT, rel);
    if (!exists(p)) continue;

    parts.push(`\n\n---\n\n# SOURCE: ${path.basename(rel)}\n`);
    parts.push(read(p));
    included++;
  }

  const outPath = path.join(OUT_DIR, `${slug(nb.name)}.md`);
  write(outPath, parts.join("\n"));
  console.log(
    `Wrote bundle: ${path.relative(ROOT, outPath)} (${included} sources)`
  );
}

function main() {
  if (!exists(PLAN)) {
    console.error(
      `Missing ${PLAN}. Generate it first with notebooklm_upload_plan.mjs.`
    );
    process.exit(2);
  }

  mkdirp(OUT_DIR);

  const planText = read(PLAN);
  const notebooks = parsePlan(planText);

  if (!notebooks.length) {
    console.error("No notebook sections found in NOTEBOOKLM_UPLOAD_PLAN.md.");
    process.exit(2);
  }

  for (const nb of notebooks) bundleNotebook(nb);
}

main();
