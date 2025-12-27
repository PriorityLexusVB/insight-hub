import "dotenv/config";
import { Command } from "commander";
import fs from "fs/promises";
import { importZip, RawThread } from "./importer/zipImport";
import { writeInbox } from "./writers/inboxWriter";
import { rawThreadsPath } from "./paths";
import { writeThreadCards } from "./writers/threadCardWriter";
import { llmSummarizeThread } from "./summarizer/llmSummarizer";
import { runRouteCommand } from "./commands/routeCommand";
import { runMergeCommand } from "./commands/mergeCommand";
import { enrichClusters } from "./commands/enrichClustersCommand";
import { runPatchCommand } from "./commands/patchCommand";
import { runAnalyzeCommand } from "./commands/analyzeCommand";

const program = new Command();

program
  .name("indexer")
  .description("Conversation Indexer CLI")
  .version("1.0.0");

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
  .description("Route thread cards using config/routing.yml")
  .action(async () => {
    await runRouteCommand();
  });

program
  .command("merge")
  .description("Cluster similar threads and mark duplicates")
  .option("--max <n>", "limit number of newest threads to consider", (v) =>
    parseInt(v, 10)
  )
  .option("--min-size <n>", "minimum cluster size", (v) => parseInt(v, 10))
  .action(async (opts: { max?: number; minSize?: number }) => {
    await runMergeCommand({ max: opts.max, minSize: opts.minSize });
  });

program
  .command("enrich-clusters")
  .description(
    "Enrich cluster markdown files with merged summary/decisions/actions using cached LLM extracts"
  )
  .option("--max <n>", "limit number of clusters to enrich", (v) =>
    parseInt(v, 10)
  )
  .action(async (opts: { max?: number }) => {
    await enrichClusters({ maxClusters: opts.max });
  });

program
  .command("patch")
  .description("Generate diff-only patch files for enriched clusters")
  .option("--max-clusters <n>", "limit number of clusters to patch", (v) =>
    parseInt(v, 10)
  )
  .action(async (opts: { maxClusters?: number }) => {
    await runPatchCommand({ maxClusters: opts.maxClusters });
  });

program
  .command("inbox")
  .description("Generate inbox view")
  .action(async () => {
    await writeInbox();
  });

program
  .command("analyze")
  .description(
    "Read-only analytics: compute CDI/CWID/maturity/load and write outputs under analytics/"
  )
  .option(
    "--out <dir>",
    "output directory (repo-relative or absolute); default: analytics/<timestamp>"
  )
  .option(
    "--emit-html",
    "also emit a local file:// dashboard (writes <out>/index.html and <out>/data.js)"
  )
  .option(
    "--emit-rollup",
    "also emit rollup summaries (writes <out>/rollup/*)"
  )
  .option(
    "--work-only",
    "limit markdown summaries to work-only scope (CSV/JSON still include full index)"
  )
  .action(
    async (opts: {
      out?: string;
      workOnly?: boolean;
      emitHtml?: boolean;
      emitRollup?: boolean;
    }) => {
      await runAnalyzeCommand({
        out: opts.out,
        workOnly: !!opts.workOnly,
        emitHtml: !!opts.emitHtml,
        emitRollup: !!opts.emitRollup,
      });
    }
  );

program
  .command("run")
  .argument("<zipPath>", "Path to ChatGPT export zip")
  .description(
    "Full pipeline: import, summarize, route, merge, enrich-clusters, inbox"
  )
  .option("--mode <mode>", "heuristic|llm", "heuristic")
  .option("--max <n>", "limit number of threads (newest first)", (v) =>
    parseInt(v, 10)
  )
  .option("--min-size <n>", "minimum cluster size for merge", (v) =>
    parseInt(v, 10)
  )
  .action(
    async (
      zipPath: string,
      opts: { mode: string; max?: number; minSize?: number }
    ) => {
      await importZip(zipPath);
      const mode = opts.mode === "llm" ? "llm" : "heuristic";
      await runSummarize({ mode, max: opts.max });
      await runRouteCommand();
      await runMergeCommand({ max: opts.max, minSize: opts.minSize });
      await enrichClusters({});
      await writeInbox();
    }
  );

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
      if (done % 10 === 0)
        console.log(`LLM summarized ${done}/${limited.length}`);
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

// pnpm sometimes forwards a standalone `--` to the script (e.g. `pnpm start -- analyze --out ...`).
// Commander treats this as "end of options" and will ignore flags that follow, so we strip it.
const argv =
  process.argv.length >= 3 && process.argv[2] === "--"
    ? [process.argv[0], process.argv[1], ...process.argv.slice(3)]
    : process.argv;

program.parseAsync(argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
