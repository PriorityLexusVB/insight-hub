# NotebookLM Bundle — Tools Engineering Data
Generated: 2026-01-02T21:32:42.573Z

## Included sources
- notebooklm_upload/Tools Engineering Data/github_repo_navigation_and_patching.md
- notebooklm_upload/Tools Engineering Data/images_image_search_carousels.md
- notebooklm_upload/Tools Engineering Data/json_jsonl_csv_cleaning_validation.md
- notebooklm_upload/Tools Engineering Data/pdf_reading_screenshots.md
- notebooklm_upload/Tools Engineering Data/python_data_workbench.md
- notebooklm_upload/Tools Engineering Data/web_research_and_citations.md

---



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
