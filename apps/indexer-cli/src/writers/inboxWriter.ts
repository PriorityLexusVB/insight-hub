import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { RawThread } from '../importer/zipImport';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

export async function writeInbox(runId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const inboxPath = path.join('thread-vault', 'inbox', `${today}.md`);
  await mkdir(path.dirname(inboxPath), { recursive: true });

  // TODO: Load actual threads and routing data
  const content = `# Inbox ${today}

## New Threads
- [Sample Conversation](threads/mock-thread-1.md)

## Needs Review
- None today

## Top Tags
- #sample
- #mock
`;

  await writeFile(inboxPath, content);
}
