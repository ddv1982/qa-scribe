# Store attachments as managed files

qa-scribe will store attachment metadata in SQLite while keeping larger binary files, such as screenshots and imported files, in a managed app data folder. This keeps the primary database queryable and compact while still letting SQLite remain the source of truth for which attachments belong to Sessions, Entries, Evidence, and Findings.
