import path from "path";

/**
 * This file lives at:
 *   <repoRoot>/apps/indexer-cli/src/paths.ts
 *
 * So repo root is:
 *   path.resolve(__dirname, "../../..")
 */
export function repoRoot(): string {
  return path.resolve(__dirname, "../../..");
}

export function cacheDir(): string {
  return path.join(repoRoot(), ".cache");
}

export function summariesDir(): string {
  return path.join(cacheDir(), "summaries");
}

export function clustersCachePath(): string {
  return path.join(cacheDir(), "clusters.json");
}

export function rawThreadsPath(): string {
  return path.join(cacheDir(), "raw_threads.json");
}

export function threadVaultDir(): string {
  return path.join(repoRoot(), "thread-vault");
}

export function inboxDir(): string {
  return path.join(threadVaultDir(), "inbox");
}

export function threadsDir(): string {
  return path.join(threadVaultDir(), "threads");
}

export function clustersDir(): string {
  return path.join(threadVaultDir(), "clusters");
}

export function patchesDir(): string {
  return path.join(repoRoot(), "patches");
}
