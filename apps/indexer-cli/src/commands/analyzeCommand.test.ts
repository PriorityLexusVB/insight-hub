import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import {
  computeCDI,
  classifyWork,
  parseFrontMatterYaml,
  runAnalyzeCommand,
  toChatIndexCsv,
  type ChatIndexRow,
} from "./analyzeCommand";

test("CDI formula matches spec", () => {
  // CDI = ((emdash + constraint) / max(1, word_count)) * 1000
  const cdi = computeCDI({
    wordCount: 100,
    emdashCount: 2,
    constraintCount: 3,
  });
  assert.equal(cdi, 50);

  const cdiMin = computeCDI({
    wordCount: 0,
    emdashCount: 1,
    constraintCount: 0,
  });
  assert.equal(cdiMin, 1000);
});

test("parseFrontMatterYaml handles nested router + arrays", () => {
  const md = `---
thread_uid: 11111111-1111-1111-1111-111111111111
title: Hello
domain: dealership_ops
apps: ["indexer-cli", "github"]
tags:
  - ops
  - tooling
router:
  primary_home:
    file: docs/infra/INDEX.md
    section: Overview
  confidence: 0.92
merge:
  cluster_id: CL-00012
---

Body text.
`;

  const { meta, body } = parseFrontMatterYaml(md);
  assert.equal(meta.thread_uid, "11111111-1111-1111-1111-111111111111");
  assert.equal(meta.router.primary_home.file, "docs/infra/INDEX.md");
  assert.equal(meta.router.confidence, 0.92);
  assert.deepEqual(meta.apps, ["indexer-cli", "github"]);
  assert.ok(body.includes("Body text."));
});

test("classifier honors domain dealership_* => ops", () => {
  const res = classifyWork({
    meta: { domain: "dealership_ops" },
    title: "Random",
    bodyText: "Unrelated",
  });
  assert.deepEqual(res, { is_work: true, work_type: "ops" });
});

test("classifier honors docs/personal => personal (not work)", () => {
  const res = classifyWork({
    meta: {
      router: { primary_home: { file: "docs/personal/INDEX.md" } },
    },
    title: "Random",
    bodyText: "Unrelated",
  });
  assert.deepEqual(res, { is_work: false, work_type: "personal" });
});

test("classifier honors docs/movies => entertainment (not work)", () => {
  const res = classifyWork({
    meta: {
      router: { primary_home: { file: "docs/movies/INDEX.md" } },
    },
    title: "Random",
    bodyText: "Unrelated",
  });
  assert.deepEqual(res, { is_work: false, work_type: "entertainment" });
});

test("analyze creates outputs and CSV header is correct", async () => {
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "insight-hub-analyze-")
  );
  const threadVault = path.join(tmpRoot, "thread-vault");
  const threads = path.join(threadVault, "threads");
  const outDir = path.join(tmpRoot, "analytics", "_dev");

  await fs.mkdir(threads, { recursive: true });

  const threadId = "11111111-1111-1111-1111-111111111111";
  const md = `---
thread_uid: ${threadId}
title: Test Thread
created_at: 2025-01-01T00:00:00.000Z
last_active_at: 2025-01-01T01:00:00.000Z
domain: dealership_ops
apps: ["indexer-cli"]
tags: ["ops", "tooling"]
router:
  primary_home:
    file: docs/infra/INDEX.md
    section: Overview
  confidence: 0.92
merge:
  cluster_id: CL-00012
---

## Summary
This conversation should verify edge case behavior — do not break.

\`\`\`
code block should not count words
\`\`\`
`;
  await fs.writeFile(path.join(threads, `${threadId}.md`), md, "utf8");

  await runAnalyzeCommand({
    out: path.relative(tmpRoot, outDir),
    workOnly: true,
    paths: { repoRoot: tmpRoot, threadsDir: threads },
  });

  const expected = [
    "chat_index.csv",
    "chat_index.json",
    "data_dictionary.md",
    "work_only.csv",
    "work_summary.md",
    "leadership_vs_builder.md",
    "leverage_audit.md",
  ];

  for (const f of expected) {
    const p = path.join(outDir, f);
    const s = await fs.stat(p);
    assert.ok(s.size > 0, `${f} should not be empty`);
  }

  const csv = await fs.readFile(path.join(outDir, "chat_index.csv"), "utf8");
  const header = csv.split(/\r?\n/)[0];
  assert.equal(
    header,
    [
      "thread_uid",
      "title",
      "domain",
      "apps",
      "tags",
      "primary_home_file",
      "primary_home_section",
      "router_confidence",
      "cluster_id",
      "word_count",
      "emdash_count",
      "constraint_count",
      "CDI",
      "turns_total",
      "user_turns",
      "assistant_turns",
      "cwid",
      "cwid_is_proxy",
      "maturity_score",
      "load_score",
      "is_work",
      "work_type",
    ].join(",")
  );
});

test("analyze --emit-html creates index.html + data.js", async () => {
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "insight-hub-analyze-html-")
  );
  const threadVault = path.join(tmpRoot, "thread-vault");
  const threads = path.join(threadVault, "threads");
  const outDir = path.join(tmpRoot, "analytics", "_dev");

  await fs.mkdir(threads, { recursive: true });

  const threadId = "22222222-2222-2222-2222-222222222222";
  const md = `---
thread_uid: ${threadId}
title: HTML Dash Thread
created_at: 2025-01-01T00:00:00.000Z
last_active_at: 2025-01-01T00:10:00.000Z
domain: dealership_ops
apps: ["indexer-cli"]
tags: ["ops"]
router:
  primary_home:
    file: docs/infra/INDEX.md
    section: Overview
  confidence: 0.92
merge:
  cluster_id: CL-00012
---

## Summary
This should emit HTML.
`;
  await fs.writeFile(path.join(threads, `${threadId}.md`), md, "utf8");

  await runAnalyzeCommand({
    out: path.relative(tmpRoot, outDir),
    workOnly: false,
    emitHtml: true,
    paths: { repoRoot: tmpRoot, threadsDir: threads },
  });

  const expected = [
    "chat_index.json",
    "chat_index.csv",
    "index.html",
    "data.js",
  ];
  for (const f of expected) {
    const p = path.join(outDir, f);
    const s = await fs.stat(p);
    assert.ok(s.size > 0, `${f} should not be empty`);
  }

  const dataJs = await fs.readFile(path.join(outDir, "data.js"), "utf8");
  assert.ok(dataJs.includes("window.__CHAT_INDEX__"));

  const html = await fs.readFile(path.join(outDir, "index.html"), "utf8");
  assert.ok(html.includes("Work-only"));
  assert.ok(html.includes('<th data-k="title">Title'));

  // Regression: the inline dashboard script must be syntactically valid.
  const scripts: Array<{ attrs: string; body: string }> = [];
  const re = /<script(\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    scripts.push({ attrs: m[1] ?? "", body: m[2] ?? "" });
  }
  assert.equal(scripts.length, 2);
  assert.ok(/\ssrc=/.test(scripts[0].attrs));
  assert.doesNotThrow(() => new vm.Script(scripts[1].body));
});

test("analyze --emit-rollup dedupes by cluster_id and picks a deterministic winner", async () => {
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "insight-hub-analyze-rollup-")
  );
  const threadVault = path.join(tmpRoot, "thread-vault");
  const threads = path.join(threadVault, "threads");
  const outDir = path.join(tmpRoot, "analytics", "_dev");

  await fs.mkdir(threads, { recursive: true });

  const clusterId = "CL-ROLLUP-1";
  const base = `
domain: dealership_ops
apps: ["indexer-cli"]
tags: ["ops"]
router:
  primary_home:
    file: docs/infra/INDEX.md
    section: Overview
  confidence: 0.92
merge:
  cluster_id: ${clusterId}
`;

  const id1 = "33333333-3333-3333-3333-333333333333";
  const id2 = "44444444-4444-4444-4444-444444444444";

  // Same approx turns, but id2 has higher CDI (more emdash/constraints) => higher CWID.
  const md1 = `---
thread_uid: ${id1}
title: Rollup Winner? (low CDI)
created_at: 2025-01-01T00:00:00.000Z
last_active_at: 2025-01-01T00:10:00.000Z
${base}---

Hello world.
`;

  const md2 = `---
thread_uid: ${id2}
title: Rollup Winner (high CDI)
created_at: 2025-01-01T00:00:00.000Z
last_active_at: 2025-01-01T00:10:00.000Z
${base}---

Text — with emphasis.
[constraint: must]
[constraint: should]
`;

  await fs.writeFile(path.join(threads, `${id1}.md`), md1, "utf8");
  await fs.writeFile(path.join(threads, `${id2}.md`), md2, "utf8");

  await runAnalyzeCommand({
    out: path.relative(tmpRoot, outDir),
    workOnly: false,
    emitRollup: true,
    paths: { repoRoot: tmpRoot, threadsDir: threads },
  });

  const rollupJsonPath = path.join(outDir, "rollup", "rollup.json");
  const rollupMdPath = path.join(outDir, "rollup", "rollup.md");
  const dedupeReportPath = path.join(outDir, "rollup", "dedupe_report.json");
  const collisionsMdPath = path.join(outDir, "rollup", "collisions.md");

  for (const p of [
    rollupJsonPath,
    rollupMdPath,
    dedupeReportPath,
    collisionsMdPath,
  ]) {
    const s = await fs.stat(p);
    assert.ok(s.size > 0, `${path.basename(p)} should not be empty`);
  }

  const rollups = JSON.parse(
    await fs.readFile(rollupJsonPath, "utf8")
  ) as any[];
  assert.equal(rollups.length, 1);
  assert.equal(rollups[0].thread_uid, id2);
  assert.equal(rollups[0].cluster_id, clusterId);
  assert.equal(rollups[0].dupe_count, 2);
  assert.equal(rollups[0].dedupe_key_type, "cluster_id");
  assert.equal(rollups[0].dedupe_key, clusterId);
  assert.equal(rollups[0].aliases.length, 2);
});

test("analyze --emit-rollup home fallback has a max-size guardrail", async () => {
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "insight-hub-analyze-rollup-homeguard-")
  );
  const threadVault = path.join(tmpRoot, "thread-vault");
  const threads = path.join(threadVault, "threads");
  const outDir = path.join(tmpRoot, "analytics", "_dev");

  await fs.mkdir(threads, { recursive: true });

  const home = "docs/infra/INDEX.md";
  const base = `
domain: dealership_ops
apps: ["indexer-cli"]
tags: ["ops"]
router:
  primary_home:
    file: ${home}
    section: Overview
  confidence: 0.92
`;

  const ids = [
    "55555555-5555-5555-5555-555555555555",
    "66666666-6666-6666-6666-666666666666",
    "77777777-7777-7777-7777-777777777777",
    "88888888-8888-8888-8888-888888888888",
  ];

  for (const id of ids) {
    const md = `---
thread_uid: ${id}
title: Home fallback guard ${id}
created_at: 2025-01-01T00:00:00.000Z
last_active_at: 2025-01-01T00:10:00.000Z
${base}---

Hello.
`;
    await fs.writeFile(path.join(threads, `${id}.md`), md, "utf8");
  }

  await runAnalyzeCommand({
    out: path.relative(tmpRoot, outDir),
    workOnly: false,
    emitRollup: true,
    paths: { repoRoot: tmpRoot, threadsDir: threads },
  });

  const rollupJsonPath = path.join(outDir, "rollup", "rollup.json");
  const collisionsMdPath = path.join(outDir, "rollup", "collisions.md");

  const rollups = JSON.parse(
    await fs.readFile(rollupJsonPath, "utf8")
  ) as any[];

  // HOME_FALLBACK_MERGE_MAX is 3; 4 threads to same home should NOT merge.
  assert.equal(rollups.length, 4);

  const collisions = await fs.readFile(collisionsMdPath, "utf8");
  assert.ok(collisions.includes("Fallback prevented"));
  assert.ok(collisions.includes(home));
});

test("toChatIndexCsv emits correct header", () => {
  const rows: ChatIndexRow[] = [
    {
      thread_uid: "t",
      title: "x",
      created_at: null,
      last_active_at: null,
      domain: "",
      apps: [],
      tags: [],
      primary_home_file: "",
      primary_home_section: "",
      router_confidence: null,
      cluster_id: "",
      word_count: 1,
      emdash_count: 0,
      constraint_count: 0,
      CDI: 0,
      turns_total: null,
      user_turns: null,
      assistant_turns: null,
      messages_total: null,
      cwid: null,
      cwid_is_proxy: true,
      maturity_score: 0,
      load_score: 0,
      is_work: false,
      work_type: "unknown",
    },
  ];

  const csv = toChatIndexCsv(rows);
  assert.ok(csv.startsWith("thread_uid,title,domain,apps,tags,"));
});

test("toChatIndexCsv serializes arrays as JSON strings", () => {
  const rows: ChatIndexRow[] = [
    {
      thread_uid: "t",
      title: "x",
      created_at: null,
      last_active_at: null,
      domain: "",
      apps: ["a", "b"],
      tags: ["t1"],
      primary_home_file: "",
      primary_home_section: "",
      router_confidence: null,
      cluster_id: "",
      word_count: 1,
      emdash_count: 0,
      constraint_count: 0,
      CDI: 0,
      turns_total: null,
      user_turns: null,
      assistant_turns: null,
      messages_total: null,
      cwid: null,
      cwid_is_proxy: true,
      maturity_score: 0,
      load_score: 0,
      is_work: false,
      work_type: "unknown",
    },
  ];

  const csv = toChatIndexCsv(rows).trimEnd();
  const lines = csv.split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes('"[""a"",""b""]"'));
  assert.ok(lines[1].includes('"[""t1""]"'));
});
