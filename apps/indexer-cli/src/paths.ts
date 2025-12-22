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
