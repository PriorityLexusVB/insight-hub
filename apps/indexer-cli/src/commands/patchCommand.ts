import fs from "fs/promises";
import path from "path";
import { clustersDir, patchesDir, repoRoot } from "../paths";

type PatchManifestItem = {
  cluster_id: string;
  destination: string;
  kind: "patch" | "skipped";
  patch_file?: string;
  used_anchor?: boolean;
  anchor_section?: string | null;
  insertion_mode?: "anchored" | "append";
  anchor_found?: boolean;
  skipped_reason?:
    | "duplicate_cluster_block"
    | "no_destination"
    | "no_merged_output";
};

type PatchManifest = {
  run_id: string;
  created_at: string;
  items: PatchManifestItem[];
};

/** Escape string for use inside RegExp */
function escapeRegExp(str: string): string {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Detect the dominant EOL so patch hunks apply cleanly */
function detectEol(s: string): string {
  return s.includes("\r\n") ? "\r\n" : "\n";
}

/** Convert a block to lines without changing the destination file’s EOL */
function blockToLines(block: unknown): string[] {
  return String(block ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trimEnd()
    .split("\n");
}

/** Preserve whether the original content ended with an EOL */
function withSameTrailingNewline(
  oldContent: string,
  newContent: string,
  eol: string
): string {
  const oldHas = oldContent.endsWith(eol);
  const newHas = newContent.endsWith(eol);
  if (oldHas && !newHas) return newContent + eol;
  if (!oldHas && newHas) return newContent.slice(0, -eol.length);
  return newContent;
}

function contentToLines(content: string, eol: string): string[] {
  if (!content) return [];
  const lines = content.split(eol);
  // If content ends with EOL, split() yields a trailing empty string; remove it.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Insert block directly “under” a named section line.
 * - Matches markdown headings: ## Thread Inbox
 * - Also matches plain lines: Thread Inbox or Thread Inbox:
 * - Inserts after heading + after any immediate blank lines.
 * - If heading not found: falls back to append-only.
 */
function insertUnderNamedSection(
  content: string,
  sectionName: string,
  block: string
): {
  next: string;
  usedAnchor: boolean;
  eol: string;
  insertAt: number;
  insertedLines: string[];
} {
  const eol = detectEol(content);
  const lines = contentToLines(content, eol);

  const mdHeadingRe = new RegExp(
    `^#{1,6}\\s*${escapeRegExp(sectionName)}\\s*:?\\s*$`,
    "i"
  );
  const plainHeadingRe = new RegExp(
    `^\\s*${escapeRegExp(sectionName)}\\s*:?\\s*$`,
    "i"
  );

  const headingIdx = lines.findIndex(
    (l) => mdHeadingRe.test(l) || plainHeadingRe.test(l)
  );
  if (headingIdx === -1) {
    const { next, insertAt, insertedLines } = appendBlock(content, block, eol);
    return { next, usedAnchor: false, eol, insertAt, insertedLines };
  }

  // Insert after the heading line and any immediate blank lines.
  let insertAt = headingIdx + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === "") insertAt++;

  const blockLines = blockToLines(block);

  // Make the insertion “clean” without altering surrounding content.
  const insert: string[] = [];
  if (insertAt > 0 && (lines[insertAt - 1]?.trim() ?? "") !== "")
    insert.push("");
  insert.push(...blockLines);
  if (insertAt < lines.length && (lines[insertAt]?.trim() ?? "") !== "")
    insert.push("");

  lines.splice(insertAt, 0, ...insert);

  const nextJoined = lines.join(eol);
  return {
    next: withSameTrailingNewline(content, nextJoined, eol),
    usedAnchor: true,
    eol,
    insertAt,
    insertedLines: insert,
  };
}

/** Append a block with a clean blank-line boundary (no reformatting) */
function appendBlock(
  content: string,
  block: string,
  eol: string
): {
  next: string;
  insertAt: number;
  insertedLines: string[];
} {
  const blockLines = blockToLines(block);
  if (!content) {
    const next = blockLines.join(eol) + eol;
    return {
      next: withSameTrailingNewline(content, next, eol),
      insertAt: 0,
      insertedLines: blockLines,
    };
  }

  // Trim only trailing EOLs, not whitespace inside the file.
  const trailingEols = new RegExp(`${escapeRegExp(eol)}+$`);
  const base = content.replace(trailingEols, "");

  const insertedLines = ["", ...blockLines];
  const next = `${base}${eol}${eol}${blockLines.join(eol)}${eol}`;
  const oldLines = contentToLines(content, eol);
  const baseLines = contentToLines(base, eol);
  const insertAt = baseLines.length;
  return {
    next: withSameTrailingNewline(content, next, eol),
    insertAt,
    insertedLines,
  };
}

const SECTION_ANCHORS_BY_BASENAME = new Map<string, string>([
  ["GLOBAL_APP_CREATION_MASTER_NOTES_v4.txt", "Thread Inbox"],
]);

function getAnchorSectionForDestination(destPath: string): string | null {
  return SECTION_ANCHORS_BY_BASENAME.get(path.basename(destPath)) ?? null;
}

function destinationAlreadyHasClusterBlock(
  content: string,
  clusterId: string
): boolean {
  const re = new RegExp(
    // Be tolerant to dash variants (—, –, -) to avoid re-patching due to typography drift.
    `^##\\s+Cluster\\s+${escapeRegExp(
      clusterId
    )}\\s+[-–—]\\s+Merged Output\\s*$`,
    "im"
  );
  return re.test(content);
}

export const __test__ = {
  insertUnderNamedSection,
  appendBlock,
  destinationAlreadyHasClusterBlock,
  getAnchorSectionForDestination,
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

function toTitleCase(raw: string): string {
  const words = (raw || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  const ACRONYMS = new Set([
    "cpo",
    "hr",
    "ai",
    "api",
    "mcp",
    "vscode",
    "bdc",
    "vin",
  ]);

  return words
    .map((w) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function standardHeader(rel: string): string {
  // Don't force markdown headers into .txt files.
  if (/\.txt$/i.test(rel)) return "";
  const title = toTitleCase(titleFromPath(rel));
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

function buildUnifiedDiffInsert(params: {
  relPath: string;
  oldText: string;
  insertAt: number; // 0-based line index in oldText (without trailing EOL line)
  insertedLines: string[];
  context?: number;
}): string {
  const rel = params.relPath;
  const eol = detectEol(params.oldText);
  const oldLines = contentToLines(params.oldText, eol);

  const insertAt = Math.max(0, Math.min(params.insertAt, oldLines.length));
  const ctx =
    typeof params.context === "number" ? Math.max(0, params.context) : 3;

  const start = Math.max(0, insertAt - ctx);
  const end = Math.min(oldLines.length, insertAt + ctx);

  const pre = oldLines.slice(start, insertAt);
  const post = oldLines.slice(insertAt, end);

  const oldStart = start + 1;
  const oldCount = pre.length + post.length;
  const newStart = start + 1;
  const newCount = pre.length + params.insertedLines.length + post.length;

  const hunkHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
  return [
    `--- a/${rel}`,
    `+++ b/${rel}`,
    hunkHeader,
    ...pre.map((l) => ` ${l}`),
    ...params.insertedLines.map((l) => `+${l}`),
    ...post.map((l) => ` ${l}`),
    "",
  ].join("\n");
}

export async function runPatchCommand(
  opts: {
    maxClusters?: number;
    paths?: {
      repoRoot: string;
      clustersDir: string;
      patchesDir: string;
    };
  } = {}
): Promise<void> {
  const root = opts.paths?.repoRoot ?? repoRoot();
  const clustersPath = opts.paths?.clustersDir ?? clustersDir();
  const patchesPath = opts.paths?.patchesDir ?? patchesDir();

  const runId = runIdNow();
  const runDir = path.join(patchesPath, runId);
  await fs.mkdir(runDir, { recursive: true });

  const files = (await fs.readdir(clustersPath))
    .filter((f) => f.startsWith("CL-") && f.endsWith(".md"))
    .sort();

  const max =
    typeof opts.maxClusters === "number" && opts.maxClusters > 0
      ? opts.maxClusters
      : files.length;

  const items: PatchManifestItem[] = [];

  for (const file of files.slice(0, max)) {
    const clusterId = file.replace(".md", "");
    const clusterPath = path.join(clustersPath, file);
    const md = await fs.readFile(clusterPath, "utf8");

    const destinationRaw = parseSuggestedDestination(md);
    if (!destinationRaw) {
      items.push({
        cluster_id: clusterId,
        destination: "",
        kind: "skipped",
        skipped_reason: "no_destination",
      });
      continue;
    }

    const destination = assertSafeRepoRelative(destinationRaw);
    const merged = extractMergedOutputForDestination(clusterId, md);
    if (!merged) {
      items.push({
        cluster_id: clusterId,
        destination,
        kind: "skipped",
        skipped_reason: "no_merged_output",
      });
      continue;
    }

    const destAbs = path.join(root, destination);

    let existing: string | null = null;
    try {
      existing = await fs.readFile(destAbs, "utf8");
    } catch {
      existing = null;
    }

    const existingText = existing ?? "";
    if (
      existing &&
      destinationAlreadyHasClusterBlock(existingText, clusterId)
    ) {
      items.push({
        cluster_id: clusterId,
        destination,
        kind: "skipped",
        skipped_reason: "duplicate_cluster_block",
      });
      continue;
    }

    const anchorSection = getAnchorSectionForDestination(destination);

    // Decide insertion strategy (anchor if known; else append)
    let next: string;
    let usedAnchor = false;
    let insertAt = 0;
    let insertedLines: string[] = [];

    if (existing === null) {
      // New file: if we have an anchor, bootstrap the section line so we can insert under it.
      if (anchorSection) {
        const bootstrap = `${anchorSection}\n\n`;
        const r = insertUnderNamedSection(
          bootstrap,
          anchorSection,
          standardHeader(destination) + merged
        );
        next = r.next;
        usedAnchor = r.usedAnchor;
        insertAt = 0;
        insertedLines = blockToLines(next);
      } else {
        next = standardHeader(destination) + merged;
        usedAnchor = false;
        insertAt = 0;
        insertedLines = blockToLines(next);
      }

      const patch = buildUnifiedDiffAppend({
        relPath: destination,
        oldText: null,
        appendText: next,
      });

      const patchFileRel = `${clusterId}.patch`;
      const patchFileAbs = path.join(runDir, patchFileRel);
      await fs.writeFile(patchFileAbs, patch, "utf8");

      items.push({
        cluster_id: clusterId,
        destination,
        kind: "patch",
        patch_file: path
          .join("patches", runId, patchFileRel)
          .replace(/\\/g, "/"),
        used_anchor: usedAnchor,
        anchor_section: anchorSection,
        insertion_mode: usedAnchor ? "anchored" : "append",
        anchor_found: usedAnchor,
      });
      continue;
    }

    if (anchorSection) {
      const r = insertUnderNamedSection(existingText, anchorSection, merged);
      next = r.next;
      usedAnchor = r.usedAnchor;
      insertAt = r.insertAt;
      insertedLines = r.insertedLines;

      if (
        path.basename(destination) ===
          "GLOBAL_APP_CREATION_MASTER_NOTES_v4.txt" &&
        !usedAnchor
      ) {
        console.warn(
          `[patch] WARNING: Thread Inbox anchor not found; fell back to append for ${destination}`
        );
      }
    } else {
      const eol = detectEol(existingText);
      const r = appendBlock(existingText, merged, eol);
      next = r.next;
      usedAnchor = false;
      insertAt = r.insertAt;
      insertedLines = r.insertedLines;
    }

    // If no change, skip
    if (next === existingText) {
      items.push({
        cluster_id: clusterId,
        destination,
        kind: "skipped",
        skipped_reason: "duplicate_cluster_block",
      });
      continue;
    }

    const patch = buildUnifiedDiffInsert({
      relPath: destination,
      oldText: existingText,
      insertAt,
      insertedLines,
      context: 3,
    });

    const patchFileRel = `${clusterId}.patch`;
    const patchFileAbs = path.join(runDir, patchFileRel);
    await fs.writeFile(patchFileAbs, patch, "utf8");

    items.push({
      cluster_id: clusterId,
      destination,
      kind: "patch",
      patch_file: path.join("patches", runId, patchFileRel).replace(/\\/g, "/"),
      used_anchor: usedAnchor,
      anchor_section: anchorSection,
      insertion_mode: usedAnchor ? "anchored" : "append",
      anchor_found: usedAnchor,
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
  const topManifestAbs = path.join(patchesPath, "manifest.json");
  await fs.writeFile(topManifestAbs, JSON.stringify(manifest, null, 2), "utf8");

  const patchCount = items.filter((i) => i.kind === "patch").length;
  console.log(`Generated ${patchCount} patch files.`);
  console.log(`Manifest: ${runManifestAbs}`);
}
