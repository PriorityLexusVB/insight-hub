import fs from "fs";
import path from "path";
import { promisify } from "util";
import unzipper from "unzipper";
import { v4 as uuidv4 } from "uuid";
import { repoRoot, runDir, rawThreadsPath } from "../paths";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

export interface Message {
  role: string;
  text: string;
}

export interface RawThread {
  thread_uid: string;
  title: string;
  created_at: string;
  last_active_at: string;
  messages: Message[];
}

async function resolveZipPath(zipPath: string): Promise<string> {
  const normalized = zipPath.replace(/\\/g, "/");

  const candidates = path.isAbsolute(normalized)
    ? [normalized]
    : [
        path.resolve(repoRoot(), normalized),
        path.resolve(process.cwd(), normalized),
      ];

  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error(
    `Zip not found: ${zipPath}\nTried:\n- ${candidates.join("\n- ")}`
  );
}

export async function importZip(
  zipPath: string
): Promise<{ runId: string; resolvedZipPath: string }> {
  const runId = uuidv4();
  const extractPath = runDir(runId);
  const outputPath = rawThreadsPath();
  const resolvedZipPath = await resolveZipPath(zipPath);

  // Create directories if they don't exist
  await mkdir(extractPath, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });

  // Extract zip
  await fs
    .createReadStream(resolvedZipPath)
    .pipe(unzipper.Extract({ path: extractPath }))
    .promise();

  // TODO: Implement actual chat.html parsing
  // For now, just create a mock raw_threads.json
  const mockThreads: RawThread[] = [
    {
      thread_uid: "mock-thread-1",
      title: "Sample Conversation",
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
      messages: [
        { role: "user", text: "Hello, I need help with something" },
        { role: "assistant", text: "Sure, how can I help you today?" },
      ],
    },
  ];

  await writeFile(outputPath, JSON.stringify(mockThreads, null, 2));

  return { runId, resolvedZipPath };
}
