import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
