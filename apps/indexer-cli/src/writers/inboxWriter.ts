import fsp from "fs/promises";
import path from "path";
import { inboxDir, threadsDir } from "../paths";

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function stripYamlString(v: string): string {
  const t = (v || "").trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function extractFrontmatterValue(md: string, key: string): string {
  const lines = (md || "").split(/\r?\n/);
  if (lines[0] !== "---") return "";
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === "---") break;
    const m = line.match(new RegExp(`^${key}:\\s*(.*)\\s*$`));
    if (m) return stripYamlString(m[1] || "");
  }
  return "";
}

export async function writeInbox(): Promise<void> {
  const date = todayISODate();
  const outDir = inboxDir();
  const outPath = path.join(outDir, `${date}.md`);

  await fsp.mkdir(outDir, { recursive: true });

  let entries: string[] = [];
  try {
    entries = await fsp.readdir(threadsDir());
  } catch {
    entries = [];
  }

  const threadFiles = entries.filter((f) => f.endsWith(".md"));

  if (threadFiles.length === 0) {
    const content = [
      `# Director Inbox — ${date}`,
      "",
      "No imported threads found. Run: `indexer import <zipPath>`",
      "",
    ].join("\n");
    await fsp.writeFile(outPath, content, "utf8");
    return;
  }

  const items: string[] = [];
  for (const file of threadFiles.sort()) {
    const full = path.join(threadsDir(), file);
    let md = "";
    try {
      md = await fsp.readFile(full, "utf8");
    } catch {
      continue;
    }

    const title =
      extractFrontmatterValue(md, "title") || file.replace(/\.md$/, "");
    const uid =
      extractFrontmatterValue(md, "thread_uid") || file.replace(/\.md$/, "");

    // from thread-vault/inbox -> ../threads/<uid>.md
    const rel = `../threads/${uid}.md`;
    items.push(`- [${title}](${rel})`);
  }

  const content = [`# Director Inbox — ${date}`, "", ...items, ""].join("\n");
  await fsp.writeFile(outPath, content, "utf8");
}
