import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { RawThread } from '../importer/zipImport';
import { threadVaultDir } from '../paths';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

export async function writeThreadCards(runId: string): Promise<void> {
  const threadsPath = threadsDir();
  await mkdir(threadsPath, { recursive: true });

  // TODO: Load actual raw_threads.json from .cache/run/${runId}/
  const mockThreads: RawThread[] = [{
    thread_uid: 'mock-thread-1',
    title: 'Sample Conversation',
    created_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
    messages: [
      { role: 'user', text: 'Hello, I need help with something' },
      { role: 'assistant', text: 'Sure, how can I help you today?' }
    ]
  }];

  for (const thread of mockThreads) {
    const content = `---
uid: ${thread.thread_uid}
title: ${thread.title}
created: ${thread.created_at}
updated: ${thread.last_active_at}
---

# ${thread.title}

## Messages
${thread.messages.map(msg => `### ${msg.role}\n${msg.text}`).join('\n\n')}
`;

    await writeFile(
      path.join(threadsPath, `${thread.thread_uid}.md`),
      content
    );
  }

  console.log(`Wrote ${mockThreads.length} thread cards to ${threadsPath}`);
}
