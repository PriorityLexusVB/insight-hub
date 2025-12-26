import "dotenv/config";
import { Command } from "commander";
import fs from "fs/promises";
import { importZip, RawThread } from "./importer/zipImport";
import { writeInbox } from "./writers/inboxWriter";
import { rawThreadsPath } from "./paths";
import { writeThreadCards } from "./writers/threadCardWriter";
import { llmSummarizeThread } from "./summarizer/llmSummarizer";

const program = new Command();

program
  .name("indexer")
  .description("Conversation Indexer CLI")
  .version("1.0.0");

program
  .command("run")
  .argument("<zipPath>", "Path to ChatGPT export zip")
  .description("Full pipeline: import, summarize, route, inbox")
  .action(async (zipPath: string) => {
    await importZip(zipPath);
    await runSummarize({ mode: "heuristic" });
    await writeInbox();
  });

program
  .command("import")
  .argument("<zipPath>", "Path to ChatGPT export zip")
  .description("Import zip file and extract conversations")
  .action(async (zipPath: string) => {
    await importZip(zipPath);
  });

program
  .command("summarize")
  .description("Generate thread cards for imported conversations")
  .option("--mode <mode>", "heuristic|llm", "heuristic")
  .option("--max <n>", "limit number of threads (newest first)", (v) =>
    parseInt(v, 10)
  )
  .action(async (opts: { mode: string; max?: number }) => {
    const mode = opts.mode === "llm" ? "llm" : "heuristic";
    await runSummarize({ mode, max: opts.max });
  });

program
  .command("route")
  .description("Route conversations based on rules")
  .action(async () => {
    console.log(
      "Route command not implemented in this build (use the routeCommand version if you added it)."
    );
  });

program
  .command("inbox")
  .description("Generate inbox view")
  .action(async () => {
    await writeInbox();
  });

async function loadThreadsNewestFirst(): Promise<RawThread[]> {
  const raw = await fs.readFile(rawThreadsPath(), "utf8");
  const threads: RawThread[] = JSON.parse(raw);

  return threads.sort(
    (a, b) =>
      new Date(b.last_active_at).getTime() -
      new Date(a.last_active_at).getTime()
  );
}

async function runSummarize(params: {
  mode: "heuristic" | "llm";
  max?: number;
}): Promise<void> {
  const threads = await loadThreadsNewestFirst();
  const limited =
    typeof params.max === "number" && params.max > 0
      ? threads.slice(0, params.max)
      : threads;

  if (params.mode === "llm") {
    const extracts = new Map<string, any>();
    let done = 0;

    for (const t of limited) {
      const ex = await llmSummarizeThread(t);
      extracts.set(t.thread_uid, ex);
      done++;
      if (done % 10 === 0) {
        console.log(`LLM summarized ${done}/${limited.length}`);
      }
    }

    await writeThreadCards({
      threads: limited,
      mode: "llm",
      llmExtracts: extracts,
    });
    return;
  }

  await writeThreadCards({ threads: limited, mode: "heuristic" });
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
