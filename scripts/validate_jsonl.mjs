import fs from "fs";

const pth = process.argv[2];
if (!pth) {
  console.error("Usage: node scripts/validate_jsonl.mjs <file.jsonl>");
  process.exit(2);
}
if (!fs.existsSync(pth)) {
  console.error("MISSING:", pth);
  process.exit(1);
}
const raw = fs.readFileSync(pth, "utf8").trim();
if (!raw) {
  console.error("EMPTY FILE:", pth);
  process.exit(1);
}
const lines = raw.split(/\r?\n/).filter(Boolean);
console.log("lines", lines.length);
for (let i = 0; i < Math.min(3, lines.length); i++) JSON.parse(lines[i]);
console.log("first 3 ok");
