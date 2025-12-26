import { Command } from "commander";
import { importZip } from "./importer/zipImport";
import { writeInbox } from "./writers/inboxWriter";
import { writeThreadCards } from "./writers/threadCardWriter";
import fs from "fs/promises";
import { rawThreadsPath } from "./paths";
import { RawThread } from "./importer/zipImport";

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
    await runSummarize();
    // route is currently a no-op unless you implement it; safe to call later
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
  .action(async () => {
    await runSummarize();
  });

program
  .command("route")
  .description("Route conversations based on rules")
  .action(async () => {
    console.log("Route command not implemented yet");
  });

program
  .command("inbox")
  .description("Generate inbox view")
  .action(async () => {
    await writeInbox();
  });

async function runSummarize(): Promise<void> {
  // rawThreadsPath is a function in paths.ts
  const p = rawThreadsPath();
  const raw = await fs.readFile(p, "utf8");
  const threads: RawThread[] = JSON.parse(raw);

  await writeThreadCards(threads);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
