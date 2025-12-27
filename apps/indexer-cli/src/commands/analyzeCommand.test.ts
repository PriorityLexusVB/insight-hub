import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  computeCDI,
  classifyWorkType,
  runAnalyzeCommand,
  toChatIndexCsv,
  type ChatIndexRow,
} from "./analyzeCommand";

test("CDI formula matches spec", () => {
  // CDI = ((emdash + constraint) / max(1, word_count)) * 1000
  const cdi = computeCDI({ wordCount: 100, emdashCount: 2, constraintCount: 3 });
  assert.equal(cdi, 50);

  const cdiMin = computeCDI({ wordCount: 0, emdashCount: 1, constraintCount: 0 });
  assert.equal(cdiMin, 1000);
});

test("work_type classifier is deterministic", () => {
  assert.deepEqual(classifyWorkType("pnpm build failed on github PR"), {
    is_work: true,
    work_type: "technical",
  });

  assert.deepEqual(classifyWorkType("need a brochure design in canva"), {
    is_work: true,
    work_type: "creative",
  });

  assert.deepEqual(classifyWorkType("watchlist: movie thriller"), {
    is_work: false,
    work_type: "entertainment",
  });
});

test("analyze creates outputs and CSV header is correct", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "insight-hub-analyze-"));
  const threadVault = path.join(tmpRoot, "thread-vault");
  const threads = path.join(threadVault, "threads");
  const outDir = path.join(tmpRoot, "analytics", "_dev");

  await fs.mkdir(threads, { recursive: true });

  const threadId = "11111111-1111-1111-1111-111111111111";
  const md = `---\nthread_uid: ${threadId}\ntitle: Test Thread\n---\n\n## Summary\nThis conversation should verify edge case behavior — do not break.\n\n\n\`\`\`\ncode block should not count words\n\`\`\`\n`;
  await fs.writeFile(path.join(threads, `${threadId}.md`), md, "utf8");

  await runAnalyzeCommand({
    out: path.relative(tmpRoot, outDir),
    workOnly: true,
    paths: { repoRoot: tmpRoot, threadsDir: threads },
  });

  const expected = [
    "chat_index.csv",
    "chat_index.json",
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
      "thread_id",
      "title",
      "word_count",
      "emdash_count",
      "constraint_count",
      "CDI",
      "messages_total",
      "messages_user",
      "messages_assistant",
      "turns_total",
      "CWID",
      "system_maturity",
      "cognitive_load",
      "is_work",
      "work_type",
    ].join(",")
  );
});

test("toChatIndexCsv emits correct header", () => {
  const rows: ChatIndexRow[] = [
    {
      thread_id: "t",
      title: "x",
      word_count: 1,
      emdash_count: 0,
      constraint_count: 0,
      CDI: 0,
      messages_total: null,
      messages_user: null,
      messages_assistant: null,
      turns_total: null,
      CWID: null,
      system_maturity: 0,
      cognitive_load: 0,
      is_work: false,
      work_type: "unknown",
    },
  ];

  const csv = toChatIndexCsv(rows);
  assert.ok(csv.startsWith("thread_id,title,word_count,"));
});
