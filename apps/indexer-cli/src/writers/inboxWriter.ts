import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { RawThread } from "../importer/zipImport";
import {
  inboxDir,
  rawThreadsPath,
  threadsDir,
  clustersCachePath,
  patchesDir,
} from "../paths";

type Frontmatter = Record<string, any>;

type ClusterCacheItem = {
  cluster_id: string;
  canonical_uid: string;
  uids: string[];
  apps: string[];
  tags: string[];
  size: number;
};

type PatchManifest = {
  run_id: string;
  created_at: string;
  items: Array<{
    cluster_id: string;
    destination: string;
    kind: "patch" | "skipped";
    patch_file?: string;
    used_anchor?: boolean;
    anchor_section?: string | null;
    skipped_reason?: string;
  }>;
};

function splitFrontmatter(md: string): Frontmatter | null {
  if (!md.startsWith("---")) return null;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return null;
  const fm = md.slice(3, end).trim();
  try {
    return (yaml.load(fm) as Frontmatter) || null;
  } catch {
    return null;
  }
}

export async function writeInbox(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await fs.mkdir(inboxDir(), { recursive: true });

  const inboxPath = path.join(inboxDir(), `${today}.md`);

  let threads: RawThread[] = [];
  try {
    const raw = await fs.readFile(rawThreadsPath(), "utf8");
    threads = JSON.parse(raw);
  } catch {
    const content = `# Director Inbox — ${today}

No imported threads found. Run: \`indexer import <zipPath>\`
`;
    await fs.writeFile(inboxPath, content, "utf8");
    console.log(`Wrote inbox: ${path.resolve(inboxPath)}`);
    return;
  }

  threads.sort(
    (a, b) =>
      new Date(b.last_active_at).getTime() -
      new Date(a.last_active_at).getTime()
  );

  // Needs Review based on router block in newest cards
  const newest = threads.slice(0, 60);
  const needsReview: Array<{
    uid: string;
    title: string;
    confidence: number;
    app: string;
  }> = [];

  for (const t of newest) {
    const cardPath = path.join(threadsDir(), `${t.thread_uid}.md`);
    try {
      const md = await fs.readFile(cardPath, "utf8");
      const fm = splitFrontmatter(md);
      if (!fm) continue;
      const r = fm.router || {};
      const conf = Number(r.confidence ?? 0);
      const nh = Boolean(r.needs_human ?? false);
      const app = String(r.matched_app ?? "");
      if (nh || conf < 0.65)
        needsReview.push({
          uid: t.thread_uid,
          title: t.title || "Untitled",
          confidence: conf,
          app,
        });
    } catch {
      // ignore
    }
  }

  // Merge candidates (clusters.json)
  let clusters: ClusterCacheItem[] = [];
  try {
    const raw = await fs.readFile(clustersCachePath(), "utf8");
    clusters = JSON.parse(raw);
  } catch {
    clusters = [];
  }
  clusters.sort((a, b) => b.size - a.size);

  // Ready patches (patches/manifest.json)
  let patchManifest: PatchManifest | null = null;
  try {
    const raw = await fs.readFile(
      path.join(patchesDir(), "manifest.json"),
      "utf8"
    );
    patchManifest = JSON.parse(raw) as PatchManifest;
  } catch {
    patchManifest = null;
  }

  let content = `# Director Inbox — ${today}\n\n`;

  content += "## Newest Threads\n";
  for (const t of threads.slice(0, 15)) {
    const safeTitle = (t.title || "Untitled").replace(/\r?\n/g, " ").trim();
    content += `- [${safeTitle}](../threads/${t.thread_uid}.md)\n`;
  }

  content += "\n## Needs Review (routing)\n";
  if (needsReview.length === 0) {
    content += "- (none)\n";
  } else {
    for (const x of needsReview.slice(0, 30)) {
      const safeTitle = x.title.replace(/\r?\n/g, " ").trim();
      content += `- [${safeTitle}](../threads/${x.uid}.md) — confidence=${
        x.confidence
      } app=${x.app || "?"}\n`;
    }
  }

  content += "\n## Merge candidates (top clusters)\n";
  if (clusters.length === 0) {
    content += "- (none yet) Run: `indexer merge --max 500`\n";
  } else {
    for (const c of clusters.slice(0, 12)) {
      const appStr = c.apps?.length ? c.apps.join(", ") : "(no app)";
      content += `- [${c.cluster_id}](../clusters/${c.cluster_id}.md) — size=${c.size} canonical=${c.canonical_uid} apps=${appStr}\n`;
    }
  }

  content += "\n## Ready patches\n";
  if (
    !patchManifest ||
    !Array.isArray(patchManifest.items) ||
    patchManifest.items.length === 0
  ) {
    content += "- (none) Run: `indexer patch --max-clusters 10`\n";
  } else {
    const patchItems = patchManifest.items
      .filter((it) => it.kind === "patch" && !!it.patch_file)
      .slice(0, 20);
    if (patchItems.length === 0) {
      content += "- (none) Run: `indexer patch --max-clusters 10`\n";
    } else {
      for (const it of patchItems) {
        content += `- ${it.patch_file} → ${it.destination} (from ${it.cluster_id})\n`;
      }
    }
  }

  await fs.writeFile(inboxPath, content, "utf8");
  console.log(`Wrote inbox: ${path.resolve(inboxPath)}`);
}
