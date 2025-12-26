import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { repoRoot } from "../paths";
import { RawThread } from "../importer/zipImport";

export type Home = {
  file: string;
  section: string;
};

export type RoutingResult = {
  primary_home: Home;
  confidence: number;
  matched_app?: string;
  matched_keywords?: string[];
  needs_human: boolean;
};

type RoutingConfig = {
  version: number;
  defaults: {
    primary_home: Home;
    require_human_if_confidence_below: number;
  };
  apps: Record<
    string,
    {
      keywords: string[];
      primary_home: Home;
    }
  >;
};

function loadRoutingConfig(): RoutingConfig {
  const p = path.join(repoRoot(), "config", "routing.yml");
  const raw = fs.readFileSync(p, "utf8");
  const cfg = yaml.load(raw) as RoutingConfig;

  if (!cfg || !cfg.defaults || !cfg.apps) {
    throw new Error(`Invalid routing.yml at ${p}`);
  }
  return cfg;
}

function normalize(s: string): string {
  return (s || "").toLowerCase();
}

function scoreKeywords(text: string, keywords: string[]): { score: number; matches: string[] } {
  const t = normalize(text);
  let score = 0;
  const matches: string[] = [];

  for (const kwRaw of keywords) {
    const kw = normalize(kwRaw).trim();
    if (!kw) continue;

    if (t.includes(kw)) {
      matches.push(kwRaw);
      // base score
      score += 1;

      // bonus for longer/more specific phrases
      if (kw.length >= 10) score += 0.5;
      if (kw.split(/\s+/).length >= 2) score += 0.5;
    }
  }

  return { score, matches };
}

export function routeThread(thread: RawThread): RoutingResult {
  const cfg = loadRoutingConfig();

  const text = `${thread.title}\n${thread.messages.map((m) => `${m.role}: ${m.text}`).join("\n")}`;

  let bestApp: string | undefined;
  let bestScore = 0;
  let bestMatches: string[] = [];
  let bestHome: Home | undefined;

  for (const [appName, appCfg] of Object.entries(cfg.apps)) {
    const { score, matches } = scoreKeywords(text, appCfg.keywords);
    if (score > bestScore) {
      bestScore = score;
      bestMatches = matches;
      bestApp = appName;
      bestHome = appCfg.primary_home;
    }
  }

  // Confidence: squash score into 0..1
  // - 0 matches => 0
  // - ~3-4 matches => ~0.7-0.8
  // - >=6 matches => ~0.9+
  const confidence = bestScore <= 0 ? 0 : Math.max(0.25, Math.min(0.95, bestScore / 6));

  const primary_home = bestHome ?? cfg.defaults.primary_home;
  const needs_human = confidence < cfg.defaults.require_human_if_confidence_below;

  return {
    primary_home,
    confidence: Number(confidence.toFixed(2)),
    matched_app: bestApp,
    matched_keywords: bestMatches.slice(0, 8),
    needs_human,
  };
}
