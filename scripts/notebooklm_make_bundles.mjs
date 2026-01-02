#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "notebooklm_upload");
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

function listMdFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => a.localeCompare(b));
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

if (!fs.existsSync(SRC_DIR)) {
  console.error(
    `Missing ${SRC_DIR}. Run the upload planner with --materialize first.`
  );
  process.exit(2);
}

mkdirp(OUT_DIR);

const folders = fs
  .readdirSync(SRC_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const folder of folders) {
  const dir = path.join(SRC_DIR, folder);
  const files = listMdFiles(dir);

  if (!files.length) continue;

  const parts = [];
  parts.push(`# NotebookLM Bundle — ${folder}`);
  parts.push(`Generated: ${new Date().toISOString()}`);
  parts.push("");
  parts.push("## Included sources");
  for (const f of files) parts.push(`- ${path.relative(ROOT, f)}`);
  parts.push("");
  parts.push("---");
  parts.push("");

  for (const f of files) {
    parts.push(`\n\n---\n\n# SOURCE: ${path.basename(f)}\n`);
    parts.push(read(f));
  }

  const outPath = path.join(OUT_DIR, `${slug(folder)}.md`);
  write(outPath, parts.join("\n"));
  console.log(
    `Wrote bundle: ${path.relative(ROOT, outPath)} (${files.length} sources)`
  );
}
