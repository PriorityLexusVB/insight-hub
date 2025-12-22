#!/usr/bin/env node
import { Command } from 'commander';
import { importZip } from './importer/zipImport';
import { writeThreadCards } from './writers/threadCardWriter';
import { writeInbox } from './writers/inboxWriter';
import { routeThreads } from './router/router';

const program = new Command();

program
  .name('indexer')
  .description('Conversation Indexer CLI')
  .version('1.0.0');

program.command('run <zipPath>')
  .description('Full pipeline: import, summarize, route, inbox')
  .action(async (zipPath) => {
    const { runId } = await importZip(zipPath);
    await writeThreadCards(runId);
    await routeThreads(runId);
    await writeInbox(runId);
  });

program.command('import <zipPath>')
  .description('Import zip file and extract conversations')
  .action(importZip);

program.command('summarize')
  .description('Generate summaries for imported conversations')
  .action(() => console.log('Summarize command not implemented yet'));

program.command('route')
  .description('Route conversations based on rules')
  .action(() => console.log('Route command not implemented yet'));

program.command('inbox')
  .description('Generate inbox view')
  .action(async () => {
    try {
      await writeInbox();
    } catch (error) {
      console.error('Error generating inbox:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);
