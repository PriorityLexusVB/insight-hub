# NotebookLM Bundle — Tools Office Outputs
Generated: 2026-01-02T21:34:54.725Z

## Included sources
- notebooklm_upload/Tools Office Outputs/docs_word_python_docx__2.md
- notebooklm_upload/Tools Office Outputs/docs_word_python_docx.md
- notebooklm_upload/Tools Office Outputs/pdf_generation_reportlab__2.md
- notebooklm_upload/Tools Office Outputs/pdf_generation_reportlab.md
- notebooklm_upload/Tools Office Outputs/slides_powerpoint_pptxgenjs__2.md
- notebooklm_upload/Tools Office Outputs/slides_powerpoint_pptxgenjs.md
- notebooklm_upload/Tools Office Outputs/spreadsheets_excel_openpyxl__2.md
- notebooklm_upload/Tools Office Outputs/spreadsheets_excel_openpyxl.md

---



---

# SOURCE: docs_word_python_docx__2.md

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

# SOURCE: pdf_generation_reportlab__2.md

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

# SOURCE: slides_powerpoint_pptxgenjs__2.md

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



---

# SOURCE: spreadsheets_excel_openpyxl__2.md

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
