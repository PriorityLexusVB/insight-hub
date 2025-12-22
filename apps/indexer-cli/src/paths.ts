import path from 'path';

export function repoRoot(): string {
  return path.resolve(__dirname, "../../..");
}

export function threadVaultDir(): string {
  return path.join(repoRoot(), "thread-vault");
}

export function cacheDir(): string {
  return path.join(repoRoot(), ".cache");
}

export function rawThreadsPath(): string {
  return path.join(cacheDir(), "raw_threads.json");
}

export function runDir(runId: string): string {
  return path.join(cacheDir(), "run", runId);
}

export function inboxDir(): string {
  return path.join(threadVaultDir(), "inbox");
}

export function threadsDir(): string {
  return path.join(threadVaultDir(), "threads");
}
