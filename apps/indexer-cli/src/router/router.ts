import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { promisify } from "util";
import { repoRoot } from "../paths";

const readFile = promisify(fs.readFile);

interface RoutingRule {
  keywords: string[];
}

interface RoutingConfig {
  [appName: string]: RoutingRule;
}

export async function routeThreads(runId: string): Promise<void> {
  const configPath = path.join(repoRoot(), "config", "routing.yml");
  const config = yaml.load(await readFile(configPath, "utf8")) as RoutingConfig;

  // TODO: Implement actual routing logic
  console.log("Routing config loaded:", config);
}
