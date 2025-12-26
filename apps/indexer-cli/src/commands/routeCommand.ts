import fs from "fs/promises";
import path from "path";
import { threadsDir } from "../paths";
import { RawThread } from "../importer/zipImport";
import { routeThread } from "../router/router";
import { rawThreadsPath } from "../paths";

function parseFrontmatter(md: string): { frontmatter: string; body: string } {
  const trimmed = md;
  if (!trimmed.startsWith("---")) return { frontmatter: "", body: md };

  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: "", body: md };

  const fm = trimmed.slice(0, end + 4) + "\n";
  const body = trimmed.slice(end + 5);
  return { frontmatter: fm, body };
}

function replaceRouterBlock(frontmatter: string, routerYaml: string): string {
  // Remove any existing router block lines starting with "router:"
  const lines = frontmatter.split(/\r?\n/);
  const out: string[] = [];

  let skipping = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("router:")) {
      skipping = true;
      continue;
    }

    // stop skipping when we hit a top-level key (no indent) or end marker
    if (skipping) {
      if (line.startsWith("---")) {
        // re-insert router block before end marker
        out.push(routerYaml.trimEnd());
        out.push("---");
        skipping = false;
        continue;
      }
      if (/^[a-zA-Z0-9_\-]+:/.test(line) && !line.startsWith("  ")) {
        // top-level key begins; insert router block before it
        out.push(routerYaml.trimEnd());
        skipping = false;
        out.push(line);
        continue;
      }
      // still skipping router section
      continue;
    }

    out.push(line);
  }

  if (skipping) {
    // frontmatter didn't end cleanly; append router
    out.push(routerYaml.trimEnd());
  }

  return out.join("\n");
}

function buildRouterYaml(result: {
  primary_home: { file: string; section: string };
  confidence: number;
  matched_app?: string;
  matched_keywords?: string[];
  needs_human: boolean;
}): string {
  const kw = (result.matched_keywords || [])
    .map((k) => `"${k.replace(/"/g, '\\"')}"`)
    .join(", ");
  const matchedApp = result.matched_app
    ? `"${result.matched_app.replace(/"/g, '\\"')}"`
    : '""';

  return [
    "router:",
    "  primary_home:",
    `    file: "${result.primary_home.file}"`,
    `    section: "${result.primary_home.section}"`,
    `    confidence: ${result.confidence}`,
    `  matched_app: ${matchedApp}`,
    `  matched_keywords: [${kw}]`,
    `  needs_human: ${result.needs_human}`,
  ].join("\n");
}

export async function runRouteCommand(): Promise<void> {
  const raw = await fs.readFile(rawThreadsPath(), "utf8");
  const threads: RawThread[] = JSON.parse(raw);

  let updated = 0;
  let needsHuman = 0;

  for (const t of threads) {
    const cardPath = path.join(threadsDir(), `${t.thread_uid}.md`);

    let md: string;
    try {
      md = await fs.readFile(cardPath, "utf8");
    } catch {
      // If card doesn't exist yet, skip
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(md);
    if (!frontmatter) continue;

    const routing = routeThread(t);
    if (routing.needs_human) needsHuman++;

    const routerYaml = buildRouterYaml(routing);
    const fm2 = replaceRouterBlock(frontmatter, routerYaml);

    const newMd = fm2 + body;
    await fs.writeFile(cardPath, newMd, "utf8");
    updated++;
  }

  console.log(`Routed ${updated} thread cards. needs_human=${needsHuman}`);
}
