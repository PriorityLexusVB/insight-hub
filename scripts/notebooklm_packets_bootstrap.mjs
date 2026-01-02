#!/usr/bin/env node
/**
 * FULL REPLACEMENT FILE
 * scripts/notebooklm_packets_bootstrap.mjs
 *
 * Creates NotebookLM packet artifacts:
 *  - notebooklm_packets/INDEX.md
 *  - notebooklm_packets/tables/tools.md
 *  - notebooklm_packets/packets/tools/*.md
 *  - notebooklm_packets/packets/repo/*.md
 *
 * SAFE:
 *  - refuses to overwrite notebooklm_packets/ unless --force is provided
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "notebooklm_packets");

function nowISO() {
  return new Date().toISOString();
}
function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function writeFileFull(filepath, content) {
  mkdirp(path.dirname(filepath));
  fs.writeFileSync(filepath, content, "utf8");
}
function readIfExists(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function usage(exitCode = 0) {
  console.log(`
Usage:
  node scripts/notebooklm_packets_bootstrap.mjs [--force]

Options:
  --force   Delete and recreate notebooklm_packets/ (FULL REBUILD)
`);
  process.exit(exitCode);
}

const TOOL_PACKETS = [
  {
    tool: "web_research",
    category: "web",
    keywords: [
      "web",
      "browse",
      "browsing",
      "search",
      "research",
      "sources",
      "citations",
      "cite",
      "verify",
      "fact check",
      "links",
      "url",
      "image_query",
    ],
    file: "notebooklm_packets/packets/tools/web_research_and_citations.md",
    title: "Web Research + Citations",
    body: `
Use when you need up-to-date facts or anything that may have changed.

Rules:
- Prefer primary sources (official docs, vendor docs, filings).
- Always capture citations with URL + date.
- When “latest” is implied, confirm publication date.
- Use image search for people/places/things when visuals help.

Outputs:
- Verified facts + citations
- What changed / why it matters
- Next actions`.trim(),
  },
  {
    tool: "pdf_reading",
    category: "pdf",
    keywords: [
      "pdf",
      ".pdf",
      "extract",
      "table",
      "screenshot",
      "page",
      "render",
    ],
    file: "notebooklm_packets/packets/tools/pdf_reading_screenshots.md",
    title: "PDF Reading + Extraction",
    body: `
Use when analyzing PDFs accurately.

Rules:
- Render pages; avoid OCR unless necessary.
- Quote exact text and cite page numbers.
- For tables: extract carefully and validate totals.

Outputs:
- Findings with page references
- Extracted tables (if applicable)
- Verification steps`.trim(),
  },
  {
    tool: "pdf_generation",
    category: "pdf",
    keywords: [
      "reportlab",
      "generate pdf",
      "create pdf",
      "pdf report",
      "export pdf",
    ],
    file: "notebooklm_packets/packets/tools/pdf_generation_reportlab.md",
    title: "PDF Generation (ReportLab)",
    body: `
Use when creating PDFs programmatically.

Standards:
- Consistent margins + page numbers
- Deterministic output (same input => same PDF)
- Validate final PDF opens + paginates

Outputs:
- File path(s)
- Run instructions
- QA checklist`.trim(),
  },
  {
    tool: "docs_generation",
    category: "docs",
    keywords: [
      "docx",
      ".docx",
      "word",
      "microsoft word",
      "python-docx",
      "document",
    ],
    file: "notebooklm_packets/packets/tools/docs_word_python_docx.md",
    title: "DOCX Generation (python-docx)",
    body: `
Use when generating Word documents.

Standards:
- Use styles (Heading 1/2/3, Normal)
- Keep tables readable (header row, widths)
- Deterministic output + open-in-Word QA

Outputs:
- File path(s)
- What changed
- QA checklist`.trim(),
  },
  {
    tool: "spreadsheets",
    category: "spreadsheets",
    keywords: [
      "xlsx",
      ".xlsx",
      "excel",
      "spreadsheet",
      "openpyxl",
      "workbook",
      "worksheet",
      "pivot",
    ],
    file: "notebooklm_packets/packets/tools/spreadsheets_excel_openpyxl.md",
    title: "Spreadsheets (XLSX) Standards",
    body: `
Use when producing spreadsheet artifacts.

Standards:
- Freeze header row
- Consistent number formats
- Avoid merged cells unless unavoidable
- Include README sheet for assumptions/definitions

Outputs:
- File path
- Sheets overview
- QA checklist`.trim(),
  },
  {
    tool: "slides",
    category: "slides",
    keywords: [
      "pptx",
      ".pptx",
      "powerpoint",
      "slides",
      "deck",
      "pptxgenjs",
      "presentation",
    ],
    file: "notebooklm_packets/packets/tools/slides_powerpoint_pptxgenjs.md",
    title: "Slides (PPTXGenJS)",
    body: `
Use when generating slide decks.

Standards:
- Title-safe margins
- No overflow text
- Export + open QA in PowerPoint

Outputs:
- File path
- Slide outline
- QA checklist`.trim(),
  },
  {
    tool: "python_data",
    category: "python",
    keywords: [
      "python",
      "pandas",
      "dataframe",
      "numpy",
      "matplotlib",
      "analysis",
    ],
    file: "notebooklm_packets/packets/tools/python_data_workbench.md",
    title: "Python Data Workbench",
    body: `
Use for analysis and transformations.

Rules:
- Keep runs under timeouts
- Prefer deterministic outputs
- Export artifacts clearly

Outputs:
- Steps + outputs
- Files created
- Verification`.trim(),
  },
  {
    tool: "json_jsonl",
    category: "data",
    keywords: ["json", "jsonl", "ndjson", "csv", "parse", "validate", "schema"],
    file: "notebooklm_packets/packets/tools/json_jsonl_csv_cleaning_validation.md",
    title: "JSON/JSONL/CSV Validation",
    body: `
Use when handling structured data.

Rules:
- Strict JSON validation
- Normalize encoding/newlines
- Deterministic ordering where relevant

Outputs:
- Fix summary
- Validation evidence
- File outputs`.trim(),
  },
  {
    tool: "repo_patching",
    category: "github",
    keywords: [
      "github",
      "git",
      "repo",
      "commit",
      "diff",
      "patch",
      "apply",
      "pr",
      "pull request",
    ],
    file: "notebooklm_packets/packets/tools/github_repo_navigation_and_patching.md",
    title: "Repo Navigation + Safe Patching",
    body: `
Use when making code changes.

Rules:
- Search first; understand owners + call sites
- Minimal changes; avoid refactors unless required
- Always run verification commands
- Provide rollback steps

Outputs:
- Files changed
- Commands run + results
- Manual QA steps`.trim(),
  },
  {
    tool: "images",
    category: "images",
    keywords: ["image", "images", "carousel", "photo", "photos", "visual"],
    file: "notebooklm_packets/packets/tools/images_image_search_carousels.md",
    title: "Images + Carousels",
    body: `
Use when visuals help explain or verify.

Rules:
- Use multiple images for comparison
- Provide short captions
- Keep claims grounded in what’s visible

Outputs:
- Image set + captions
- Key observations
- Recommendation`.trim(),
  },
  {
    tool: "gmail_reader",
    category: "integrations",
    keywords: ["gmail", "email", "inbox", "from:", "subject:"],
    file: "notebooklm_packets/packets/tools/email_gmail_reader.md",
    title: "Gmail Reader",
    body: `
Use to search and read emails.

Rules:
- Use operators: from:, subject:, newer_than:, older_than:
- Summarize clearly; list action items

Outputs:
- Emails found + takeaways
- Next actions`.trim(),
  },
  {
    tool: "gcal_reader",
    category: "integrations",
    keywords: ["calendar", "gcal", "event", "meeting", "schedule"],
    file: "notebooklm_packets/packets/tools/calendar_gcal_reader.md",
    title: "Google Calendar Reader",
    body: `
Use to search and read calendar events.

Outputs:
- Schedule summary
- Conflicts + free slots`.trim(),
  },
  {
    tool: "gcontacts_reader",
    category: "integrations",
    keywords: ["contacts", "gcontacts", "address book"],
    file: "notebooklm_packets/packets/tools/contacts_gcontacts_reader.md",
    title: "Google Contacts Reader",
    body: `
Use to find contact details.

Outputs:
- Matches + best candidate`.trim(),
  },
];

function buildRepoPackets() {
  const readme = readIfExists("README.md");
  const runbook = readIfExists("RUNBOOK.md");
  const handoff = readIfExists("HANDOFF_2025-12-30.md");
  const dataDict = readIfExists("analytics/_current/data_dictionary.md");
  const workSummary = readIfExists("analytics/_current/work_summary.md");

  return [
    {
      file: "notebooklm_packets/packets/repo/repo_overview.md",
      title: "Insight Hub Repo Overview",
      body: `
Generated: ${nowISO()}

This packet set is built for NotebookLM ingestion.

Key generated outputs:
- analytics/_current/chat_index.json
- analytics/_current/chat_index.csv
- analytics/_current/index.html
- analytics/_current/data_dictionary.md
- analytics/_current/work_summary.md`.trim(),
    },
    {
      file: "notebooklm_packets/packets/repo/readme_snapshot.md",
      title: "README Snapshot",
      body: (readme || "README.md not found.").trim(),
    },
    {
      file: "notebooklm_packets/packets/repo/runbook_snapshot.md",
      title: "RUNBOOK Snapshot",
      body: (runbook || "RUNBOOK.md not found.").trim(),
    },
    {
      file: "notebooklm_packets/packets/repo/handoff_snapshot.md",
      title: "HANDOFF Snapshot",
      body: (handoff || "HANDOFF_2025-12-30.md not found.").trim(),
    },
    {
      file: "notebooklm_packets/packets/repo/analytics_data_dictionary_snapshot.md",
      title: "Analytics Data Dictionary Snapshot",
      body: (
        dataDict || "analytics/_current/data_dictionary.md not found."
      ).trim(),
    },
    {
      file: "notebooklm_packets/packets/repo/work_summary_snapshot.md",
      title: "Work Summary Snapshot",
      body: (
        workSummary || "analytics/_current/work_summary.md not found."
      ).trim(),
    },
  ];
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) usage(0);

  const force = args.includes("--force");

  if (fs.existsSync(OUT_DIR)) {
    if (!force) {
      console.error(
        `Refusing to overwrite existing ${OUT_DIR}. Re-run with --force for FULL REBUILD.`
      );
      process.exit(2);
    }
    rmrf(OUT_DIR);
  }

  mkdirp(path.join(OUT_DIR, "tables"));
  mkdirp(path.join(OUT_DIR, "packets", "tools"));
  mkdirp(path.join(OUT_DIR, "packets", "repo"));

  for (const t of TOOL_PACKETS) {
    writeFileFull(path.join(ROOT, t.file), `# ${t.title}\n\n${t.body}\n`);
  }

  const repoPackets = buildRepoPackets();
  for (const p of repoPackets) {
    writeFileFull(path.join(ROOT, p.file), `# ${p.title}\n\n${p.body}\n`);
  }

  const toolsTablePath = path.join(OUT_DIR, "tables", "tools.md");
  const rows = TOOL_PACKETS.map(
    (t) =>
      `| ${t.tool} | ${t.category} | ${t.file} | ${t.keywords.join(", ")} |`
  ).join("\n");

  writeFileFull(
    toolsTablePath,
    `# Tools Table (NotebookLM Packets)\n\nGenerated: ${nowISO()}\n\n| tool | category | packet | keywords |\n|---|---|---|---|\n${rows}\n`
  );

  const indexPath = path.join(OUT_DIR, "INDEX.md");
  writeFileFull(
    indexPath,
    `# NotebookLM Packets Index\n\nGenerated: ${nowISO()}\n\n## Tables\n- notebooklm_packets/tables/tools.md\n\n## Repo Packets\n${repoPackets
      .map((p) => `- ${p.file}`)
      .join("\n")}\n\n## Tool Packets\n${TOOL_PACKETS.map(
      (t) => `- ${t.file}`
    ).join("\n")}\n`
  );

  console.log(`✅ Bootstrapped packets at: ${OUT_DIR}`);
}

main();
