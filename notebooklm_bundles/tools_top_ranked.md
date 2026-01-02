# NotebookLM Bundle — Tools — Top (Ranked)
Generated: 2026-01-02T23:24:03.216Z

## Included sources
- notebooklm_packets/packets/tools/web_research_and_citations.md
- notebooklm_packets/packets/tools/pdf_reading_screenshots.md
- notebooklm_packets/packets/tools/github_repo_navigation_and_patching.md
- notebooklm_packets/packets/tools/json_jsonl_csv_cleaning_validation.md
- notebooklm_packets/packets/tools/spreadsheets_excel_openpyxl.md
- notebooklm_packets/packets/tools/images_image_search_carousels.md
- notebooklm_packets/packets/tools/python_data_workbench.md
- notebooklm_packets/packets/tools/email_gmail_reader.md
- notebooklm_packets/packets/tools/docs_word_python_docx.md
- notebooklm_packets/packets/tools/calendar_gcal_reader.md
- notebooklm_packets/packets/tools/contacts_gcontacts_reader.md
- notebooklm_packets/packets/tools/pdf_generation_reportlab.md
- notebooklm_packets/packets/tools/slides_powerpoint_pptxgenjs.md

---



---

# SOURCE: web_research_and_citations.md

# Web Research + Citations

Use when you need up-to-date facts or anything that may have changed.

Rules:
- Prefer primary sources (official docs, vendor docs, filings).
- Always capture citations with URL + date.
- When “latest” is implied, confirm publication date.
- Use image search for people/places/things when visuals help.

Outputs:
- Verified facts + citations
- What changed / why it matters
- Next actions



---

# SOURCE: pdf_reading_screenshots.md

# PDF Reading + Extraction

Use when analyzing PDFs accurately.

Rules:
- Render pages; avoid OCR unless necessary.
- Quote exact text and cite page numbers.
- For tables: extract carefully and validate totals.

Outputs:
- Findings with page references
- Extracted tables (if applicable)
- Verification steps



---

# SOURCE: github_repo_navigation_and_patching.md

# Repo Navigation + Safe Patching

Use when making code changes.

Rules:
- Search first; understand owners + call sites
- Minimal changes; avoid refactors unless required
- Always run verification commands
- Provide rollback steps

Outputs:
- Files changed
- Commands run + results
- Manual QA steps



---

# SOURCE: json_jsonl_csv_cleaning_validation.md

# JSON/JSONL/CSV Validation

Use when handling structured data.

Rules:
- Strict JSON validation
- Normalize encoding/newlines
- Deterministic ordering where relevant

Outputs:
- Fix summary
- Validation evidence
- File outputs



---

# SOURCE: spreadsheets_excel_openpyxl.md

# Spreadsheets (XLSX) Standards

Use when producing spreadsheet artifacts.

Standards:
- Freeze header row
- Consistent number formats
- Avoid merged cells unless unavoidable
- Include README sheet for assumptions/definitions

Outputs:
- File path
- Sheets overview
- QA checklist



---

# SOURCE: images_image_search_carousels.md

# Images + Carousels

Use when visuals help explain or verify.

Rules:
- Use multiple images for comparison
- Provide short captions
- Keep claims grounded in what’s visible

Outputs:
- Image set + captions
- Key observations
- Recommendation



---

# SOURCE: python_data_workbench.md

# Python Data Workbench

Use for analysis and transformations.

Rules:
- Keep runs under timeouts
- Prefer deterministic outputs
- Export artifacts clearly

Outputs:
- Steps + outputs
- Files created
- Verification



---

# SOURCE: email_gmail_reader.md

# Gmail Reader

Use to search and read emails.

Rules:
- Use operators: from:, subject:, newer_than:, older_than:
- Summarize clearly; list action items

Outputs:
- Emails found + takeaways
- Next actions



---

# SOURCE: docs_word_python_docx.md

# DOCX Generation (python-docx)

Use when generating Word documents.

Standards:
- Use styles (Heading 1/2/3, Normal)
- Keep tables readable (header row, widths)
- Deterministic output + open-in-Word QA

Outputs:
- File path(s)
- What changed
- QA checklist



---

# SOURCE: calendar_gcal_reader.md

# Google Calendar Reader

Use to search and read calendar events.

Outputs:
- Schedule summary
- Conflicts + free slots



---

# SOURCE: contacts_gcontacts_reader.md

# Google Contacts Reader

Use to find contact details.

Outputs:
- Matches + best candidate



---

# SOURCE: pdf_generation_reportlab.md

# PDF Generation (ReportLab)

Use when creating PDFs programmatically.

Standards:
- Consistent margins + page numbers
- Deterministic output (same input => same PDF)
- Validate final PDF opens + paginates

Outputs:
- File path(s)
- Run instructions
- QA checklist



---

# SOURCE: slides_powerpoint_pptxgenjs.md

# Slides (PPTXGenJS)

Use when generating slide decks.

Standards:
- Title-safe margins
- No overflow text
- Export + open QA in PowerPoint

Outputs:
- File path
- Slide outline
- QA checklist
