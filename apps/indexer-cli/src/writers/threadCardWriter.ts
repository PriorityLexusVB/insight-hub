import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { RawThread } from '../importer/zipImport';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

export async function writeThreadCards(runId: string): Promise<void> {
  const threadsPath = path.join('thread-vault', 'threads');
  await mkdir(threadsPath, { recursive: true });

  // TODO: Load actual raw_threads.json from .cache/run/${runId}/
  const mockThread: RawThread = {
    thread_uid: 'mock-thread-1',
    title: 'Sample Conversation',
    created_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
    messages: [
      { role: 'user', text: 'Hello, I need help with something' },
      { role: 'assistant', text: 'Sure, how can I help you today?' }
    ]
  };

  const content = `---
uid: ${mockThread.thread_uid}
title: ${mockThread.title}
created: ${mockThread.created_at}
updated: ${mockThread.last_active_at}
---

# ${mockThread.title}

## Messages
${mockThread.messages.map(msg => `### ${msg.role}\n${msg.text}`).join('\n\n')}
`;

  await writeFile(
    path.join(threadsPath, `${mockThread.thread_uid}.md`),
    content
  );
}
