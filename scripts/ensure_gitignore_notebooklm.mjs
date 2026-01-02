#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GITIGNORE = path.join(ROOT, ".gitignore");

const LINES = [
  "# NotebookLM generated artifacts",
  "NOTEBOOKLM_UPLOAD_PLAN.md",
  "notebooklm_packets/",
  "notebooklm_upload/",
];

function read(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
function write(p, s) {
  fs.writeFileSync(p, s, "utf8");
}

const cur = read(GITIGNORE);
const curSet = new Set(
  cur
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
);

let changed = false;
let out = cur.replace(/\s*$/, "");

for (const line of LINES) {
  if (!curSet.has(line)) {
    if (!out.endsWith("\n")) out += "\n";
    out += line + "\n";
    changed = true;
  }
}

if (changed) {
  write(GITIGNORE, out);
  console.log("✅ Updated .gitignore for NotebookLM generated artifacts.");
} else {
  console.log("✅ .gitignore already has NotebookLM generated artifact rules.");
}
