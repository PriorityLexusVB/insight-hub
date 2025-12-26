import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { rawThreadsPath, threadsDir } from "../paths";
import { RawThread } from "../importer/zipImport";
import { routeFromMeta } from "../router/router";

type Frontmatter = Record<string, any>;

function splitFrontmatter(md: string): { fm: string; body: string } {
  if (!md.startsWith("---")) return { fm: "", body: md };
  const end = md.indexOf("\n---", 3);
  if (end === -1) return { fm: "", body: md };
  const fm = md.slice(3, end).trim();
  const body = md.slice(end + 4);
  return { fm, body };
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
      continue;
    }

    const { fm, body } = splitFrontmatter(md);
    if (!fm) continue;

    const fmObj = (yaml.load(fm) as Frontmatter) || {};
    const apps: string[] = Array.isArray(fmObj.apps) ? fmObj.apps : [];
    const tags: string[] = Array.isArray(fmObj.tags) ? fmObj.tags : [];

    const fullText = t.messages.map((m) => `${m.role}: ${m.text}`).join("\n");
    const routing = routeFromMeta({ title: t.title, fullText, apps, tags });

    if (routing.needs_human) needsHuman++;

    fmObj.router = {
      primary_home: routing.primary_home,
      confidence: routing.confidence,
      matched_app: routing.matched_app ?? "",
      matched_keywords: routing.matched_keywords ?? [],
      needs_human: routing.needs_human,
    };

    const newFm = yaml.dump(fmObj, { lineWidth: 120 }).trimEnd();
    const newMd = `---\n${newFm}\n---\n${body.replace(/^\n/, "")}`;

    await fs.writeFile(cardPath, newMd, "utf8");
    updated++;
  }

  console.log(`Routed ${updated} thread cards. needs_human=${needsHuman}`);
}
