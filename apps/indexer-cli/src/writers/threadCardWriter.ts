import fs from "fs";
import path from "path";
import { promisify } from "util";
import { RawThread } from "../importer/zipImport";
import { heuristicSummarize } from "../summarizer/heuristicSummarizer";
import { threadsDir } from "../paths";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

function yamlEscape(s: string): string {
  const t = (s ?? "").replace(/\r?\n/g, " ").trim();
  // quote if needed
  if (/[:\[\]\{\}\#\&\*\!\|\>\'\"]/.test(t)) {
    return `"${t.replace(/"/g, '\\"')}"`;
  }
  return t;
}

function mdList(items: string[]): string {
  if (!items || items.length === 0) return "- (none)\n";
  return items.map((x) => `- ${x}`).join("\n") + "\n";
}

export async function writeThreadCards(threads: RawThread[]): Promise<void> {
  await mkdir(threadsDir(), { recursive: true });

  for (const thread of threads) {
    const extract = heuristicSummarize(thread);

    const frontmatter = [
      "---",
      `thread_uid: ${yamlEscape(thread.thread_uid)}`,
      `title: ${yamlEscape(thread.title || "Untitled")}`,
      `created_at: ${yamlEscape(thread.created_at)}`,
      `last_active_at: ${yamlEscape(thread.last_active_at)}`,
      `status: active`,
      `domain: ${yamlEscape(extract.domain)}`,
      `apps: [${extract.apps.map(yamlEscape).join(", ")}]`,
      `tags: [${extract.tags.map(yamlEscape).join(", ")}]`,
      `sensitivity: ${yamlEscape(extract.sensitivity)}`,
      `router:`,
      `  primary_home:`,
      `    file: ${yamlEscape("thread-vault/UNSORTED.md")}`,
      `    section: ${yamlEscape("Inbox")}`,
      `    confidence: 0.0`,
      `  secondary_homes: []`,
      `merge:`,
      `  cluster_id: ""`,
      `  duplicate_confidence: 0.0`,
      "---",
      "",
    ].join("\n");

    const body = [
      "## Summary",
      extract.summary,
      "",
      "## Key decisions",
      mdList(extract.key_decisions),
      "## Open questions",
      mdList(extract.open_questions),
      "## Next actions",
      extract.next_actions.length
        ? extract.next_actions.map((a, i) => `${i + 1}) [${a.priority}] ${a.text}`).join("\n") + "\n"
        : "1) (none)\n",
      "",
    ].join("\n");

    const outPath = path.join(threadsDir(), `${thread.thread_uid}.md`);
    await writeFile(outPath, frontmatter + body, "utf8");
  }

  console.log(`Wrote ${threads.length} thread cards to ${path.resolve(threadsDir())}`);
}
