import fs from "fs/promises";
import path from "path";
import { clustersDir, patchesDir, repoRoot } from "../paths";

type PatchManifestItem = {
  cluster_id: string;
  destination: string;
  patch_file: string;
};

type PatchManifest = {
  run_id: string;
  created_at: string;
  items: PatchManifestItem[];
};

function runIdNow(): string {
  // YYYYMMDD-HHMMSS (lexicographically sortable)
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function assertSafeRepoRelative(p: string): string {
  const s = (p || "").trim();
  if (!s) throw new Error("Empty destination path");
  if (path.isAbsolute(s))
    throw new Error(
      `Destination must be repo-relative, got absolute path: ${s}`
    );
  const norm = s.replace(/\\/g, "/");
  if (norm.includes(".."))
    throw new Error(`Destination must not contain '..': ${s}`);
  return norm;
}

function parseSuggestedDestination(md: string): string | null {
  const m = md.match(/\*\*Suggested destination:\*\*\s+`([^`]+)`/);
  return m?.[1]?.trim() || null;
}

function extractMergedOutputForDestination(
  clusterId: string,
  md: string
): string | null {
  const marker = "## Merged Output";
  const idx = md.indexOf(marker);
  if (idx === -1) return null;

  const section = md.slice(idx).trimEnd();
  const lines = section.split("\n");

  // Rewrite the heading and strip the suggested destination line (destination doc already implies it)
  const out: string[] = [];
  out.push(`## Cluster ${clusterId} — Merged Output`);
  out.push("");
  out.push(`_Source: thread-vault/clusters/${clusterId}.md_`);
  out.push("");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\*\*Suggested destination:\*\*/.test(line)) continue;
    // skip a single blank line after the destination line if present
    if (
      out[out.length - 1] === "" &&
      line.trim() === "" &&
      (i < 4 || /^\*\*Suggested destination:\*\*/.test(lines[i - 1] || ""))
    ) {
      continue;
    }
    out.push(line);
  }

  return out.join("\n").trimEnd() + "\n";
}

function titleFromPath(rel: string): string {
  const parts = rel.split("/").filter(Boolean);
  const base = parts[parts.length - 1] || rel;
  if (/^index\.md$/i.test(base) && parts.length >= 2)
    return parts[parts.length - 2];
  return base.replace(/\.[^.]+$/, "");
}

function standardHeader(rel: string): string {
  const title = titleFromPath(rel);
  return `# ${title}\n\n`;
}

function buildUnifiedDiffAppend(params: {
  relPath: string;
  oldText: string | null;
  appendText: string;
}): string {
  const rel = params.relPath;
  const append = params.appendText.replace(/\r\n/g, "\n");
  const addedLines = append.replace(/\n$/, "").split("\n");

  if (params.oldText === null) {
    const hunkHeader = `@@ -0,0 +1,${addedLines.length} @@`;
    return [
      "--- /dev/null",
      `+++ b/${rel}`,
      hunkHeader,
      ...addedLines.map((l) => `+${l}`),
      "",
    ].join("\n");
  }

  const old = params.oldText.replace(/\r\n/g, "\n");
  const oldNoTrail = old.endsWith("\n") ? old.slice(0, -1) : old;
  const oldLineCount = oldNoTrail ? oldNoTrail.split("\n").length : 0;

  const hunkHeader = `@@ -${oldLineCount},0 +${oldLineCount + 1},${
    addedLines.length
  } @@`;
  return [
    `--- a/${rel}`,
    `+++ b/${rel}`,
    hunkHeader,
    ...addedLines.map((l) => `+${l}`),
    "",
  ].join("\n");
}

export async function runPatchCommand(
  opts: { maxClusters?: number } = {}
): Promise<void> {
  const runId = runIdNow();
  const runDir = path.join(patchesDir(), runId);
  await fs.mkdir(runDir, { recursive: true });

  const files = (await fs.readdir(clustersDir()))
    .filter((f) => f.startsWith("CL-") && f.endsWith(".md"))
    .sort();

  const max =
    typeof opts.maxClusters === "number" && opts.maxClusters > 0
      ? opts.maxClusters
      : files.length;

  const items: PatchManifestItem[] = [];

  for (const file of files.slice(0, max)) {
    const clusterId = file.replace(".md", "");
    const clusterPath = path.join(clustersDir(), file);
    const md = await fs.readFile(clusterPath, "utf8");

    const destinationRaw = parseSuggestedDestination(md);
    if (!destinationRaw) continue;

    const destination = assertSafeRepoRelative(destinationRaw);
    const merged = extractMergedOutputForDestination(clusterId, md);
    if (!merged) continue;

    const destAbs = path.join(repoRoot(), destination);

    let oldText: string | null = null;
    try {
      oldText = await fs.readFile(destAbs, "utf8");
    } catch {
      oldText = null;
    }

    const appendBlock =
      oldText === null ? standardHeader(destination) + merged : "\n" + merged;

    const patch = buildUnifiedDiffAppend({
      relPath: destination,
      oldText,
      appendText: appendBlock,
    });

    const patchFileRel = `${clusterId}.patch`;
    const patchFileAbs = path.join(runDir, patchFileRel);
    await fs.writeFile(patchFileAbs, patch, "utf8");

    items.push({
      cluster_id: clusterId,
      destination,
      patch_file: path.join("patches", runId, patchFileRel).replace(/\\/g, "/"),
    });
  }

  const manifest: PatchManifest = {
    run_id: runId,
    created_at: new Date().toISOString(),
    items,
  };

  const runManifestAbs = path.join(runDir, "manifest.json");
  await fs.writeFile(runManifestAbs, JSON.stringify(manifest, null, 2), "utf8");

  // Also write/overwrite a top-level manifest pointer for inbox consumption.
  const topManifestAbs = path.join(patchesDir(), "manifest.json");
  await fs.writeFile(topManifestAbs, JSON.stringify(manifest, null, 2), "utf8");

  console.log(`Generated ${items.length} patch files.`);
  console.log(`Manifest: ${runManifestAbs}`);
}
