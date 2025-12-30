import fs from "fs";

const p = process.argv[2];
if (!p) {
  console.error("Usage: node scripts/validate_jsonl.mjs <file.jsonl>");
  process.exit(2);
}
if (!fs.existsSync(p)) {
  console.error("MISSING:", p);
  process.exit(1);
}
const raw = fs.readFileSync(p, "utf8");
const s = raw.trim();
if (!s) {
  console.error("EMPTY FILE:", p);
  process.exit(1);
}
const lines = s.split(/\r?\n/);
console.log("lines", lines.length);
for (let i = 0; i < Math.min(3, lines.length); i++) JSON.parse(lines[i]);
console.log("first 3 ok");
