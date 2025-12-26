import fs from "fs";
import path from "path";
import { promisify } from "util";
import { RawThread } from "../importer/zipImport";
import { threadsDir } from "../paths";
import { heuristicSummarize } from "../summarizer/heuristicSummarizer";
import type { ThreadExtract as LlmExtract } from "../summarizer/llmSummarizer";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

type Extract = {
  domain: "dealership_ops" | "personal" | "infra_agents" | "research";
  apps: string[];
  tools_used: string[];
  tags: string[];
  sensitivity: "safe_internal" | "contains_customer_pii" | "external_shareable";
  summary: string;
  key_decisions: string[];
  open_questions: string[];
  next_actions: { text: string; priority: "low" | "med" | "high" }[];
};

function yamlEscape(s: string): string {
  const t = (s ?? "").replace(/\r?\n/g, " ").trim();
  if (/[:\[\]\{\}\#\&\*\!\|\>\'"]/.test(t)) {
    return `"${t.replace(/"/g, '\\"')}"`;
  }
  return t;
}

function mdList(items: string[]): string {
  if (!items || items.length === 0) return "- (none)\n";
  return items.map((x) => `- ${x}`).join("\n") + "\n";
}

export async function writeThreadCards(params: {
  threads: RawThread[];
  mode: "heuristic" | "llm";
  llmExtracts?: Map<string, LlmExtract>;
}): Promise<void> {
  await mkdir(threadsDir(), { recursive: true });

  for (const thread of params.threads) {
    let extract: Extract;

    if (params.mode === "llm") {
      const e = params.llmExtracts?.get(thread.thread_uid);
      if (!e) {
        // fallback to heuristic if missing
        const h = heuristicSummarize(thread);
        extract = {
          domain: h.domain,
          apps: h.apps,
          tools_used: [],
          tags: h.tags,
          sensitivity: h.sensitivity,
          summary: h.summary,
          key_decisions: [],
          open_questions: h.open_questions,
          next_actions: [],
        };
      } else {
        extract = {
          domain: e.domain,
          apps: e.apps,
          tools_used: e.tools_used,
          tags: e.tags,
          sensitivity: e.sensitivity,
          summary: e.summary,
          key_decisions: e.key_decisions,
          open_questions: e.open_questions,
          next_actions: e.next_actions,
        };
      }
    } else {
      const h = heuristicSummarize(thread);
      extract = {
        domain: h.domain,
        apps: h.apps,
        tools_used: [],
        tags: h.tags,
        sensitivity: h.sensitivity,
        summary: h.summary,
        key_decisions: [],
        open_questions: h.open_questions,
        next_actions: [],
      };
    }

    const frontmatter = [
      "---",
      `thread_uid: ${yamlEscape(thread.thread_uid)}`,
      `title: ${yamlEscape(thread.title || "Untitled")}`,
      `created_at: ${yamlEscape(thread.created_at)}`,
      `last_active_at: ${yamlEscape(thread.last_active_at)}`,
      `status: active`,
      `domain: ${yamlEscape(extract.domain)}`,
      `apps: [${extract.apps.map(yamlEscape).join(", ")}]`,
      `tools_used: [${extract.tools_used.map(yamlEscape).join(", ")}]`,
      `tags: [${extract.tags.map(yamlEscape).join(", ")}]`,
      `sensitivity: ${yamlEscape(extract.sensitivity)}`,
      `router:`,
      `  primary_home:`,
      `    file: ${yamlEscape("GLOBAL_APP_CREATION_MASTER_NOTES_v4.txt")}`,
      `    section: ${yamlEscape("Thread Inbox")}`,
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
      extract.summary || "(none)",
      "",
      "## Key decisions",
      mdList(extract.key_decisions),
      "## Open questions",
      mdList(extract.open_questions),
      "## Next actions",
      extract.next_actions.length
        ? extract.next_actions
            .map((a, i) => `${i + 1}) [${a.priority}] ${a.text}`)
            .join("\n") + "\n"
        : "1) (none)\n",
      "",
    ].join("\n");

    const outPath = path.join(threadsDir(), `${thread.thread_uid}.md`);
    await writeFile(outPath, frontmatter + body, "utf8");
  }

  console.log(
    `Wrote ${params.threads.length} thread cards to ${path.resolve(
      threadsDir()
    )}`
  );
}
