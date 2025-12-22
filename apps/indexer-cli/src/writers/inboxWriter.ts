import fs from "fs";
import path from "path";
import { promisify } from "util";
import { RawThread } from "../importer/zipImport";
import { inboxDir, rawThreadsPath } from "../paths";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const access = promisify(fs.access);

export async function writeInbox(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await mkdir(inboxDir(), { recursive: true });

  const fileName = `${today}.md`;
  const inboxPath = path.join(inboxDir(), fileName);

  try {
    await access(rawThreadsPath, fs.constants.F_OK);
  } catch {
    const content = `# Director Inbox — ${today}

No imported threads found. Run: \`indexer import <zipPath>\`
`;
    await writeFile(inboxPath, content);
    console.log(`Wrote inbox: ${path.resolve(inboxPath)}`);
    return;
  }

  const rawData = await readFile(rawThreadsPath, "utf8");
  const threads: RawThread[] = JSON.parse(rawData);

  const sortedThreads = [...threads].sort(
    (a, b) =>
      new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime()
  );

  let content = `# Director Inbox — ${today}\n\n`;

  // Newest threads section
  content += "## Newest Threads\n";
  sortedThreads.slice(0, 10).forEach((thread) => {
    const safeTitle = (thread.title || "Untitled").replace(/\r?\n/g, " ").trim();
    // inbox files live under thread-vault/inbox, so thread cards are one level up in ../threads
    content += `- [${safeTitle}](../threads/${thread.thread_uid}.md)\n`;
  });

  content += "\n## Needs Review\n";
  content += "None today\n";

  content += "\n## Top Tags\n";
  content += "No tags available\n";

  await writeFile(inboxPath, content);
  console.log(`Wrote inbox: ${path.resolve(inboxPath)}`);
}
