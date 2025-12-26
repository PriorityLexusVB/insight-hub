import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { repoRoot } from "../paths";

export type Home = { file: string; section: string };

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
  if (!cfg?.defaults || !cfg?.apps) throw new Error(`Invalid routing.yml at ${p}`);
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
      score += 1;
      if (kw.length >= 10) score += 0.5;
      if (kw.split(/\s+/).length >= 2) score += 0.5;
    }
  }

  return { score, matches };
}

/**
 * Route using canonical apps first (highest confidence), then fallback to keyword scoring.
 */
export function routeFromMeta(params: {
  title: string;
  fullText: string;
  apps: string[];
  tags: string[];
}): RoutingResult {
  const cfg = loadRoutingConfig();

  // Strong signal: canonical app present
  for (const appName of params.apps || []) {
    const appCfg = cfg.apps[appName];
    if (appCfg) {
      const confidence = 0.92;
      const needs_human = confidence < cfg.defaults.require_human_if_confidence_below;
      return {
        primary_home: appCfg.primary_home,
        confidence,
        matched_app: appName,
        matched_keywords: [],
        needs_human,
      };
    }
  }

  // Fallback: keyword scoring
  const text = `${params.title}\n${params.fullText}\n${(params.tags || []).join(" ")}`;

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

  const confidence = bestScore <= 0 ? 0 : Math.max(0.25, Math.min(0.9, bestScore / 6));
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
