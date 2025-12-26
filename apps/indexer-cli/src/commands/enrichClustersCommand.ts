import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { clustersDir, repoRoot, summariesDir, threadsDir } from "../paths";

type ClusterMeta = {
  cluster_id: string;
  canonical_uid: string;
  uids: string[];
  bucket?: string;
  focus_app?: string;
  domain?: string;
  apps?: string[];
  tags?: string[];
  size: number;
};

type LlmExtract = {
  summary: string;
  key_decisions: string[];
  open_questions: string[];
  next_actions: Array<{ text: string; priority: "low" | "med" | "high" }>;
  domain: string;
  apps: string[];
  tools_used: string[];
  tags: string[];
  sensitivity: string;
};

type ThreadFrontmatter = Record<string, any>;

type RoutingConfig = {
  version: number;
  defaults: {
    primary_home: { file: string; section: string };
    require_human_if_confidence_below: number;
  };
  apps: Record<
    string,
    {
      keywords: string[];
      primary_home: { file: string; section: string };
    }
  >;
};

function uniqStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of items) {
    const k = s.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s.trim());
  }
  return out;
}

function uniqActions(
  actions: Array<{ text: string; priority: string }>
): Array<{ text: string; priority: string }> {
  const seen = new Set<string>();
  const out: Array<{ text: string; priority: string }> = [];
  for (const a of actions) {
    const t = (a.text || "").trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push({ text: t, priority: a.priority || "med" });
  }
  return out;
}

function sortByPriority(actions: Array<{ text: string; priority: string }>) {
  const rank = (p: string) => (p === "high" ? 0 : p === "med" ? 1 : 2);
  return [...actions].sort((a, b) => rank(a.priority) - rank(b.priority));
}

async function loadRoutingConfig(): Promise<RoutingConfig> {
  const p = path.join(repoRoot(), "config", "routing.yml");
  const raw = await fs.readFile(p, "utf8");
  const cfg = yaml.load(raw) as RoutingConfig;
  if (!cfg?.defaults?.primary_home?.file || !cfg?.apps)
    throw new Error(`Invalid routing.yml at ${p}`);
  return cfg;
}

async function readThreadFrontmatter(
  threadUid: string
): Promise<ThreadFrontmatter | null> {
  const p = path.join(threadsDir(), `${threadUid}.md`);
  const md = await fs.readFile(p, "utf8");
  if (!md.startsWith("---")) return null;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return null;
  const fmText = md.slice(3, end).trim();
  return (yaml.load(fmText) as ThreadFrontmatter) || null;
}

async function readClusterMeta(clusterId: string): Promise<ClusterMeta> {
  // cluster markdown already exists; parse “Size” and canonical/links isn’t reliable
  // So we infer uids by reading the markdown and parsing ../threads/<uid>.md links.
  const p = path.join(clustersDir(), `${clusterId}.md`);
  const md = await fs.readFile(p, "utf8");

  const uidMatches = Array.from(
    md.matchAll(/\(\.\.\/threads\/([a-f0-9\-]+)\.md\)/gi)
  ).map((m) => m[1]);
  const uids = Array.from(new Set(uidMatches));

  // canonical line: **Canonical:** `...`
  const canonicalMatch = md.match(/\*\*Canonical:\*\*\s+`([^`]+)`/);
  const canonical_uid = canonicalMatch?.[1] || uids[0] || "";

  // size line
  const sizeMatch = md.match(/\*\*Size:\*\*\s+(\d+)/);
  const size = sizeMatch ? parseInt(sizeMatch[1], 10) : uids.length;

  // bucket/focus app/domain if present
  const bucketMatch = md.match(/\*\*Bucket:\*\*\s+(.+)/);
  const focusMatch = md.match(/\*\*Focus app:\*\*\s+(.+)/);
  const domainMatch = md.match(/\*\*Domain:\*\*\s+(.+)/);

  return {
    cluster_id: clusterId,
    canonical_uid,
    uids,
    bucket: bucketMatch?.[1]?.trim(),
    focus_app: focusMatch?.[1]?.trim(),
    domain: domainMatch?.[1]?.trim(),
    size,
  };
}

async function loadLlmExtract(threadUid: string): Promise<LlmExtract | null> {
  const p = path.join(summariesDir(), `${threadUid}.json`);
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as LlmExtract;
  } catch {
    return null;
  }
}

function normalizeKey(s: string): string {
  return (s || "").toLowerCase().trim();
}

function containsAny(text: string, keywords: string[]): boolean {
  const t = normalizeKey(text);
  for (const kw of keywords) {
    const k = normalizeKey(kw);
    if (!k) continue;
    if (t.includes(k)) return true;
  }
  return false;
}

const TAG_DESTINATION_RULES: Array<{
  keywords: string[];
  destination: string;
}> = [
  {
    keywords: [
      "cpo",
      "certified pre-owned",
      "warranty",
      "comparison",
      "competitor",
      "showroom",
    ],
    destination: "docs/marketing/cpo-comparisons.md",
  },
  {
    keywords: [
      "brochure",
      "tri-fold",
      "trifold",
      "tri fold",
      "one-sheet",
      "onesheet",
      "flyer",
    ],
    destination: "docs/marketing/brochures.md",
  },
  {
    keywords: ["movie", "movies", "tracker", "watched", "rating"],
    destination: "docs/movies/tracker.md",
  },
  {
    keywords: [
      "infra",
      "dev",
      "tools",
      "github",
      "supabase",
      "vscode",
      "visual studio code",
    ],
    destination: "docs/infra/index.md",
  },
  {
    keywords: ["personal", "health", "kids", "family"],
    destination: "docs/personal/index.md",
  },
];

function pickClusterDestination(params: {
  cfg: RoutingConfig;
  meta: ClusterMeta;
  extracts: LlmExtract[];
}): string {
  const allTags = uniqStrings(
    params.extracts.flatMap((e) => e.tags || [])
  ).join(" ");

  // 1) Tag-based mapping (explicit, deterministic). These are cross-cutting docs
  // and should override potentially-noisy app signals.
  for (const rule of TAG_DESTINATION_RULES) {
    if (containsAny(allTags, rule.keywords)) return rule.destination;
  }

  // 2) Reliable focus app (aggregated from extracts)
  const counts = new Map<string, number>();
  for (const e of params.extracts) {
    for (const app of e.apps || []) {
      const a = String(app || "").trim();
      if (!a) continue;
      counts.set(a, (counts.get(a) || 0) + 1);
    }
  }

  let bestApp: string | null = null;
  let bestCount = 0;
  for (const [app, c] of counts.entries()) {
    if (!params.cfg.apps[app]) continue;
    if (c > bestCount) {
      bestApp = app;
      bestCount = c;
    }
  }

  const n = Math.max(1, params.extracts.length);
  const threshold = Math.max(2, Math.ceil(n * 0.6));
  if (bestApp && bestCount >= threshold) {
    return params.cfg.apps[bestApp].primary_home.file;
  }

  // 3) Fallback
  return "GLOBAL_APP_CREATION_MASTER_NOTES_v4.txt";
}

function renderMergedSection(params: {
  destination: string;
  mergedSummary: string;
  decisions: string[];
  questions: string[];
  actions: Array<{ text: string; priority: string }>;
}): string {
  const lines: string[] = [];
  lines.push("## Merged Output");
  lines.push("");
  lines.push(`**Suggested destination:** \`${params.destination}\``);
  lines.push("");
  lines.push("### Merged summary");
  lines.push(params.mergedSummary.trim() || "(none)");
  lines.push("");
  lines.push("### Consolidated decisions");
  lines.push(
    params.decisions.length
      ? params.decisions.map((d) => `- ${d}`).join("\n")
      : "- (none)"
  );
  lines.push("");
  lines.push("### Consolidated open questions");
  lines.push(
    params.questions.length
      ? params.questions.map((q) => `- ${q}`).join("\n")
      : "- (none)"
  );
  lines.push("");
  lines.push("### Consolidated next actions");
  if (params.actions.length) {
    for (const a of params.actions) lines.push(`- [${a.priority}] ${a.text}`);
  } else {
    lines.push("- (none)");
  }
  lines.push("");
  lines.push("### Suggested cleanup");
  lines.push("- Keep the canonical thread as the main reference.");
  lines.push(
    "- Archive or mark the other threads as duplicates after you confirm no unique decisions remain."
  );
  lines.push("");
  return lines.join("\n");
}

function mergeSummaries(extracts: LlmExtract[]): string {
  // Sentence-level dedupe, cap ~10 sentences.
  const maxSentences = 10;
  const maxChars = 900;

  const finalize = (text: string): string => {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (!t) return t;
    if (/[.!?…]$/.test(t)) return t;
    const lastSpace = t.lastIndexOf(" ");
    if (lastSpace >= 200) return t.slice(0, lastSpace).trimEnd() + "…";
    return t + "…";
  };

  const trimToCap = (text: string): string => {
    if (text.length <= maxChars) return text;
    const cut = text.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(" ");
    const safe = (lastSpace >= 200 ? cut.slice(0, lastSpace) : cut).trimEnd();
    return safe + "…";
  };

  const seen = new Set<string>();
  const out: string[] = [];
  let usedConversationLead = false;

  const summaries = extracts
    .map((e) => (e.summary || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const s of summaries) {
    const sentences = s
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter(Boolean);

    for (const sent of sentences) {
      const k = sent.toLowerCase();
      if (!k || seen.has(k)) continue;

      // Avoid repeating the generic "The conversation ..." lead sentence over and over
      if (/^the conversation\s+(revolves|focuses|centers)/i.test(sent)) {
        if (usedConversationLead) continue;
        usedConversationLead = true;
      }

      seen.add(k);
      out.push(sent);
      const joined = out.join(" ");
      if (out.length >= maxSentences) return finalize(trimToCap(joined));
      if (joined.length >= maxChars) return finalize(trimToCap(joined));
    }
  }

  const joined = out.join(" ");
  return finalize(trimToCap(joined));
}

export async function enrichClusters(
  opts: { maxClusters?: number } = {}
): Promise<void> {
  const files = (await fs.readdir(clustersDir()))
    .filter((f) => f.startsWith("CL-") && f.endsWith(".md"))
    .sort();

  const maxClusters =
    typeof opts.maxClusters === "number" && opts.maxClusters > 0
      ? opts.maxClusters
      : files.length;

  let processed = 0;

  const routingCfg = await loadRoutingConfig();

  for (const file of files.slice(0, maxClusters)) {
    const clusterId = file.replace(".md", "");
    const meta = await readClusterMeta(clusterId);

    if (!meta.uids.length) continue;

    // load LLM extracts (skip ones not summarized yet)
    const extracts: Array<{ uid: string; e: LlmExtract }> = [];
    for (const uid of meta.uids) {
      const e = await loadLlmExtract(uid);
      if (e) extracts.push({ uid, e });
    }

    // If no extracts, just skip enrichment
    if (extracts.length === 0) continue;

    // Put canonical first if we have it
    extracts.sort((a, b) =>
      a.uid === meta.canonical_uid ? -1 : b.uid === meta.canonical_uid ? 1 : 0
    );

    const destination = pickClusterDestination({
      cfg: routingCfg,
      meta,
      extracts: extracts.map((x) => x.e),
    });

    const mergedSummary = mergeSummaries(extracts.map((x) => x.e));

    const decisions = uniqStrings(
      extracts.flatMap((x) => x.e.key_decisions || [])
    ).slice(0, 20);
    const questions = uniqStrings(
      extracts.flatMap((x) => x.e.open_questions || [])
    ).slice(0, 20);
    const actions = sortByPriority(
      uniqActions(
        extracts.flatMap((x) =>
          (x.e.next_actions || []).map((a) => ({
            text: a.text,
            priority: a.priority,
          }))
        )
      )
    ).slice(0, 20);

    // Append merged section to cluster markdown (replace if already exists)
    const clusterPath = path.join(clustersDir(), `${clusterId}.md`);
    const md = await fs.readFile(clusterPath, "utf8");

    const marker = "## Merged Output";
    const base = md.includes(marker)
      ? md.split(marker)[0].trimEnd()
      : md.trimEnd();

    const mergedSection = renderMergedSection({
      destination,
      mergedSummary,
      decisions,
      questions,
      actions,
    });

    await fs.writeFile(clusterPath, `${base}\n\n${mergedSection}`, "utf8");

    processed++;
  }

  console.log(`Enriched ${processed} clusters.`);
}
