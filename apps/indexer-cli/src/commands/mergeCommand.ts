import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { RawThread } from "../importer/zipImport";
import { rawThreadsPath, threadsDir, clustersDir, clustersCachePath } from "../paths";

type Frontmatter = Record<string, any>;

type ThreadMeta = {
  uid: string;
  title: string;
  last_active_at: string;
  domain: string;
  apps: string[];
  tags: string[];
  bucket: string;
  tagWords: Set<string>;
  titleWords: Set<string>;
};

type ClusterCache = {
  cluster_id: string;
  canonical_uid: string;
  uids: string[];
  bucket: string;
  focus_app: string;
  domain: string;
  apps: string[];
  tags: string[];
  size: number;
};

const JUNK_TAG_EXACT = new Set(
  [
    "div","span","/div","class","style","font-size","color","width","display","table",
    "margin","margin-bottom","padding","var","px","rem","href","src","html","css",
    "hljs-string","hljs-keyword","hljs-title","hljs-number","hljs-comment",
    "data-line-start","data-line-end",
  ].map((x) => x.toLowerCase())
);

// generic words + code/schema junk you DO NOT want clustering on
const GENERIC_WORDS = new Set(
  [
    // generic
    "ai","app","apps","tool","tools","project","workflow","system","design","build","setup","help",
    "notes","update","issue","fix","prompt","chat","chats","thread","threads",
    // code-ish
    "const","let","var","function","return","import","export","default","async","await",
    "true","false","null","undefined","json","yaml","md","tsx","ts","js","node","pnpm",
    "classname","props","state","hook","component","jsx","html","css","style","class",
    "value","name","id","data","line","start","end",
    // schema-ish (movie tracker columns etc.)
    "title","year","status","tags","english","language","loved","liked","watched","notes","disturbance",
    "kids","animals",
  ].map((x) => x.toLowerCase())
);

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function safeTitle(s: string): string {
  return (s || "Untitled").replace(/\r?\n/g, " ").trim();
}

function toWords(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 3)
    .filter((x) => !GENERIC_WORDS.has(x));
}

function setFromWords(words: string[]): Set<string> {
  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function intersectionCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

function normalizeTag(tag: string): string | null {
  const t0 = (tag || "").trim();
  if (!t0) return null;

  const lower = t0.toLowerCase();
  if (JUNK_TAG_EXACT.has(lower)) return null;
  if (lower.startsWith("hljs")) return null;
  if (lower.startsWith("data-")) return null;
  if (lower.startsWith("aria-")) return null;

  if (/[<>]/.test(t0)) return null;
  if (t0.includes("/")) return null;
  if (t0.startsWith(".")) return null;

  const t = t0.toLowerCase().replace(/\s+/g, " ").trim();
  if (t.length < 3) return null;
  if (/^\d+$/.test(t)) return null;

  // reject tags that are basically generic words
  const words = toWords(t);
  if (words.length === 0) return null;

  return t;
}

function cleanTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const x of tags || []) {
    const n = normalizeTag(String(x));
    if (n) out.push(n);
  }
  return uniq(out).slice(0, 15);
}

function normalizeApps(apps: string[]): string[] {
  return uniq((apps || []).map((a) => String(a).trim()).filter(Boolean));
}

async function readThreadFrontmatter(threadUid: string): Promise<Frontmatter | null> {
  const cardPath = path.join(threadsDir(), `${threadUid}.md`);
  let md: string;
  try {
    md = await fs.readFile(cardPath, "utf8");
  } catch {
    return null;
  }
  if (!md.startsWith("---")) return null;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return null;
  const fmText = md.slice(3, end).trim();
  try {
    return (yaml.load(fmText) as Frontmatter) || null;
  } catch {
    return null;
  }
}

async function cleanClustersDir(): Promise<void> {
  await fs.mkdir(clustersDir(), { recursive: true });
  const items = await fs.readdir(clustersDir());
  for (const it of items) {
    if (it.startsWith("CL-") && it.endsWith(".md")) {
      await fs.unlink(path.join(clustersDir(), it)).catch(() => {});
    }
  }
}

function formatClusterId(n: number): string {
  return `CL-${String(n).padStart(5, "0")}`;
}

function similarity(a: ThreadMeta, b: ThreadMeta): { score: number; shared: number; tagSim: number; titleSim: number } {
  const tagSim = jaccard(a.tagWords, b.tagWords);
  const titleSim = jaccard(a.titleWords, b.titleWords);

  const sharedTag = intersectionCount(a.tagWords, b.tagWords);
  const sharedTitle = intersectionCount(a.titleWords, b.titleWords);
  const shared = sharedTag + Math.floor(0.5 * sharedTitle);

  // signal gate:
  // - 2+ shared tag words, OR
  // - strong title similarity + 1+ shared tag word
  const ok =
    sharedTag >= 2 ||
    (titleSim >= 0.62 && sharedTag >= 1) ||
    tagSim >= 0.30 ||
    titleSim >= 0.82;

  if (!ok) return { score: 0, shared, tagSim, titleSim };

  const score = Math.min(0.99, 0.75 * tagSim + 0.25 * titleSim);
  return { score, shared, tagSim, titleSim };
}

function acceptThreshold(bucket: string): number {
  if (bucket.startsWith("domain:")) return 0.40;
  return 0.30;
}

async function updateThreadMergeFields(threadUid: string, clusterId: string, dupConfidence: number): Promise<void> {
  const cardPath = path.join(threadsDir(), `${threadUid}.md`);
  const md = await fs.readFile(cardPath, "utf8");
  if (!md.startsWith("---")) return;

  const end = md.indexOf("\n---", 3);
  if (end === -1) return;

  const fmText = md.slice(3, end).trim();
  const body = md.slice(end + 4).replace(/^\n/, "");

  const fmObj = (yaml.load(fmText) as Frontmatter) || {};
  fmObj.merge = fmObj.merge || {};
  fmObj.merge.cluster_id = clusterId;
  fmObj.merge.duplicate_confidence = Number(dupConfidence.toFixed(2));

  const newFm = yaml.dump(fmObj, { lineWidth: 120 }).trimEnd();
  await fs.writeFile(cardPath, `---\n${newFm}\n---\n${body}`, "utf8");
}

async function writeClusterMarkdown(clusterId: string, meta: ThreadMeta[], canonicalUid: string, bucket: string, focusApp: string, domain: string): Promise<void> {
  await fs.mkdir(clustersDir(), { recursive: true });
  const clusterPath = path.join(clustersDir(), `${clusterId}.md`);

  const appsUnion = uniq(meta.flatMap((m) => m.apps)).slice(0, 8);
  const tagsUnion = uniq(meta.flatMap((m) => m.tags)).slice(0, 25);

  const sortedByDate = [...meta].sort(
    (a, b) => new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime()
  );

  const lines: string[] = [];
  lines.push(`# Cluster ${clusterId}`);
  lines.push("");
  lines.push(`**Size:** ${meta.length}`);
  lines.push(`**Canonical:** \`${canonicalUid}\``);
  lines.push(`**Bucket:** ${bucket}`);
  lines.push(`**Focus app:** ${focusApp}`);
  lines.push(`**Domain:** ${domain}`);
  lines.push("");
  lines.push(`**Apps (union):** ${appsUnion.length ? appsUnion.join(", ") : "(none)"}`);
  lines.push(`**Tags:** ${tagsUnion.length ? tagsUnion.join(", ") : "(none)"}`);
  lines.push("");
  lines.push("## Threads");
  for (const m of sortedByDate) {
    lines.push(`- [${safeTitle(m.title)}](../threads/${m.uid}.md) — last_active=${m.last_active_at}${m.uid === canonicalUid ? " **(canonical)**" : ""}`);
  }
  lines.push("");
  lines.push("## Recommendation");
  lines.push("- Keep the canonical thread as the source of truth.");
  lines.push("- Review non-canonical threads for unique decisions, then archive or merge notes into the canonical doc.");
  lines.push("");

  await fs.writeFile(clusterPath, lines.join("\n"), "utf8");
}

export async function runMergeCommand(opts: { max?: number; minSize?: number } = {}): Promise<void> {
  const raw = await fs.readFile(rawThreadsPath(), "utf8");
  const threads: RawThread[] = JSON.parse(raw);

  threads.sort((a, b) => new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime());
  const limited = typeof opts.max === "number" && opts.max > 0 ? threads.slice(0, opts.max) : threads;
  const minSize = typeof opts.minSize === "number" && opts.minSize > 1 ? opts.minSize : 3;

  await cleanClustersDir();

  const metas: ThreadMeta[] = [];
  for (const t of limited) {
    const fm = await readThreadFrontmatter(t.thread_uid);

    const apps = normalizeApps(Array.isArray(fm?.apps) ? fm!.apps.map(String) : []);
    const tags = cleanTags(Array.isArray(fm?.tags) ? fm!.tags.map(String) : []);
    const domain = String(fm?.domain ?? "unknown");

    const focusApp = apps.length ? apps[0] : "(none)";
    const bucket = apps.length ? `app:${apps[0]}` : `domain:${domain}`;

    const tagWords = setFromWords(tags.flatMap((p) => toWords(p)));
    const titleWords = setFromWords(toWords(t.title || ""));

    metas.push({
      uid: t.thread_uid,
      title: t.title || "Untitled",
      last_active_at: t.last_active_at,
      domain,
      apps,
      tags,
      bucket,
      tagWords,
      titleWords,
    });
  }

  const buckets = new Map<string, ThreadMeta[]>();
  for (const m of metas) {
    if (!buckets.has(m.bucket)) buckets.set(m.bucket, []);
    buckets.get(m.bucket)!.push(m);
  }

  const allClusters: { bucket: string; members: ThreadMeta[] }[] = [];

  for (const [bucket, items] of buckets.entries()) {
    const clusters: { centroid: ThreadMeta; members: ThreadMeta[] }[] = [];

    for (const m of items) {
      let bestIdx = -1;
      let bestScore = 0;

      for (let i = 0; i < clusters.length; i++) {
        const sim = similarity(m, clusters[i].centroid);
        if (sim.score > bestScore) {
          bestScore = sim.score;
          bestIdx = i;
        }
      }

      const thresh = acceptThreshold(bucket);
      if (bestIdx >= 0 && bestScore >= thresh) {
        const c = clusters[bestIdx];
        c.members.push(m);

        const newest =
          new Date(m.last_active_at).getTime() > new Date(c.centroid.last_active_at).getTime() ? m : c.centroid;

        c.centroid = {
          ...newest,
          tags: uniq([...c.centroid.tags, ...m.tags]).slice(0, 15),
          apps: uniq([...c.centroid.apps, ...m.apps]).slice(0, 2),
          tagWords: new Set([...c.centroid.tagWords, ...m.tagWords]),
          titleWords: new Set([...c.centroid.titleWords, ...m.titleWords]),
        };
      } else {
        clusters.push({ centroid: m, members: [m] });
      }
    }

    for (const c of clusters) {
      if (c.members.length >= minSize) allClusters.push({ bucket, members: c.members });
    }
  }

  allClusters.sort((a, b) => b.members.length - a.members.length);

  const out: ClusterCache[] = [];
  let idCounter = 1;

  for (const c of allClusters) {
    const clusterId = formatClusterId(idCounter++);
    const sorted = [...c.members].sort(
      (a, b) => new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime()
    );
    const canonical = sorted[0].uid;

    const focusApp = c.bucket.startsWith("app:") ? c.bucket.slice(4) : "(none)";
    const domain = sorted[0].domain || "unknown";

    await writeClusterMarkdown(clusterId, c.members, canonical, c.bucket, focusApp, domain);

    for (const m of c.members) {
      const dup = m.uid === canonical ? 0 : similarity(m, sorted[0]).score;
      await updateThreadMergeFields(m.uid, clusterId, dup);
    }

    out.push({
      cluster_id: clusterId,
      canonical_uid: canonical,
      uids: c.members.map((x) => x.uid),
      bucket: c.bucket,
      focus_app: focusApp,
      domain,
      apps: uniq(c.members.flatMap((x) => x.apps)).slice(0, 8),
      tags: uniq(c.members.flatMap((x) => x.tags)).slice(0, 25),
      size: c.members.length,
    });
  }

  await fs.writeFile(clustersCachePath(), JSON.stringify(out, null, 2), "utf8");

  console.log(`Built ${out.length} clusters (minSize=${minSize}) from ${limited.length} threads.`);
  console.log(`Wrote clusters cache: ${clustersCachePath()}`);
}
