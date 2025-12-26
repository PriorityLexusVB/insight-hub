import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";

import { __test__, runPatchCommand } from "./patchCommand";

test("destinationAlreadyHasClusterBlock tolerates dash variants", () => {
  const clusterId = "CL-00042";

  const em = `## Cluster ${clusterId} — Merged Output\n`;
  const en = `## Cluster ${clusterId} – Merged Output\n`;
  const hy = `## Cluster ${clusterId} - Merged Output\n`;

  assert.equal(__test__.destinationAlreadyHasClusterBlock(em, clusterId), true);
  assert.equal(__test__.destinationAlreadyHasClusterBlock(en, clusterId), true);
  assert.equal(__test__.destinationAlreadyHasClusterBlock(hy, clusterId), true);
});

test("insertUnderNamedSection inserts under heading; falls back to append", () => {
  const section = "Thread Inbox";
  const block = "A\nB\n";

  {
    const content = `## ${section}\n\n- Existing\n`;
    const r = __test__.insertUnderNamedSection(content, section, block);
    assert.equal(r.usedAnchor, true);
    assert.match(
      r.next,
      new RegExp(`^## ${section}\\n\\nA\\nB\\n\\n- Existing\\n?$`)
    );
  }

  {
    const content = `# Notes\n\n- Existing\n`;
    const r = __test__.insertUnderNamedSection(content, section, block);
    assert.equal(r.usedAnchor, false);
    assert.match(r.next, /- Existing\n\nA\nB\n?$/);
  }
});

test("integration: patch -> apply -> patch again yields 0 patches and duplicate skip", async () => {
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "insight-hub-patch-test-")
  );
  const threadVault = path.join(tmpRoot, "thread-vault");
  const clustersPath = path.join(threadVault, "clusters");
  const patchesPath = path.join(tmpRoot, "patches");

  await fs.mkdir(clustersPath, { recursive: true });
  await fs.mkdir(patchesPath, { recursive: true });

  // init git repo so we can `git apply`
  childProcess.execFileSync("git", ["init"], { cwd: tmpRoot, stdio: "ignore" });

  const destination = "GLOBAL_APP_CREATION_MASTER_NOTES_v4.txt";
  const destAbs = path.join(tmpRoot, destination);
  await fs.writeFile(destAbs, "Thread Inbox\n\nExisting\n", "utf8");

  const clusterId = "CL-00001";
  const clusterMd = [
    "# Cluster",
    "",
    "## Merged Output",
    "",
    `**Suggested destination:** \`${destination}\``,
    "",
    "### Merged summary",
    "Some useful content.",
    "",
  ].join("\n");
  await fs.writeFile(
    path.join(clustersPath, `${clusterId}.md`),
    clusterMd,
    "utf8"
  );

  // First run should generate a patch
  await runPatchCommand({
    maxClusters: 1,
    paths: {
      repoRoot: tmpRoot,
      clustersDir: clustersPath,
      patchesDir: patchesPath,
    },
  });

  const manifest1Raw = await fs.readFile(
    path.join(patchesPath, "manifest.json"),
    "utf8"
  );
  const manifest1 = JSON.parse(manifest1Raw) as any;

  const patchItems1 = (manifest1.items as any[]).filter(
    (i) => i.kind === "patch"
  );
  assert.equal(patchItems1.length, 1);
  assert.equal(patchItems1[0].destination, destination);
  assert.equal(patchItems1[0].insertion_mode, "anchored");
  assert.equal(patchItems1[0].anchor_found, true);

  const patchFileRel = patchItems1[0].patch_file as string;
  assert.ok(patchFileRel);

  // Apply patch
  childProcess.execFileSync("git", ["apply", patchFileRel], {
    cwd: tmpRoot,
    stdio: "ignore",
  });

  // Second run should generate 0 patches and skip as duplicate
  await runPatchCommand({
    maxClusters: 1,
    paths: {
      repoRoot: tmpRoot,
      clustersDir: clustersPath,
      patchesDir: patchesPath,
    },
  });

  const manifest2Raw = await fs.readFile(
    path.join(patchesPath, "manifest.json"),
    "utf8"
  );
  const manifest2 = JSON.parse(manifest2Raw) as any;

  const patchItems2 = (manifest2.items as any[]).filter(
    (i) => i.kind === "patch"
  );
  assert.equal(patchItems2.length, 0);

  const skipped2 = (manifest2.items as any[]).find(
    (i) => i.cluster_id === clusterId
  );
  assert.ok(skipped2);
  assert.equal(skipped2.kind, "skipped");
  assert.equal(skipped2.skipped_reason, "duplicate_cluster_block");
});
