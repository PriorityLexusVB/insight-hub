#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { importZip } from "./importer/zipImport";
import { writeThreadCards } from "./writers/threadCardWriter";
import { writeInbox } from "./writers/inboxWriter";
import { routeThreads } from "./router/router";
import { exportsDir } from "./paths";

const program = new Command();

program
  .name("indexer")
  .description("Conversation Indexer CLI")
  .version("1.0.0");

program
  .command("run <zipPath>")
  .description("Full pipeline: import, summarize, route, inbox")
  .action(async (zipPath) => {
    const { runId, resolvedZipPath } = await importZip(zipPath);
    console.log(`Imported zip. runId=${runId} zip=${resolvedZipPath}`);
    await writeThreadCards(runId);
    await routeThreads(runId);
    await writeInbox();
  });

program
  .command("import <zipPath>")
  .description("Import zip file and extract conversations")
  .action(async (zipPath) => {
    const { runId, resolvedZipPath } = await importZip(zipPath);
    console.log(`Imported zip. runId=${runId} zip=${resolvedZipPath}`);
  });

program
  .command("list-exports")
  .description("List zip files in the repo exports/ folder")
  .action(async () => {
    const dir = exportsDir();
    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      console.log(`No exports directory found: ${path.resolve(dir)}`);
      return;
    }

    const zips = entries
      .filter((name) => name.toLowerCase().endsWith(".zip"))
      .sort((a, b) => a.localeCompare(b));

    if (zips.length === 0) {
      console.log(`No .zip files found in: ${path.resolve(dir)}`);
      return;
    }

    for (const name of zips) {
      console.log(`exports/${name}`);
    }
  });

program
  .command("summarize")
  .description("Generate summaries for imported conversations")
  .action(() => console.log("Summarize command not implemented yet"));

program
  .command("route")
  .description("Route conversations based on rules")
  .action(() => console.log("Route command not implemented yet"));

program
  .command("inbox")
  .description("Generate inbox view")
  .action(async () => {
    try {
      await writeInbox();
    } catch (error) {
      console.error("Error generating inbox:", error);
      process.exit(1);
    }
  });

program.parse(process.argv);
