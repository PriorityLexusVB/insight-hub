# NotebookLM Bundle — Tools — Integrations
Generated: 2026-01-03T00:54:14.811Z

## Included sources
- notebooklm_packets/packets/tools/calendar_gcal_reader.md
- notebooklm_packets/packets/tools/contacts_gcontacts_reader.md
- notebooklm_packets/packets/tools/email_gmail_reader.md

---



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

# SOURCE: email_gmail_reader.md

# Gmail Reader

Use to search and read emails.

Rules:
- Use operators: from:, subject:, newer_than:, older_than:
- Summarize clearly; list action items

Outputs:
- Emails found + takeaways
- Next actions
