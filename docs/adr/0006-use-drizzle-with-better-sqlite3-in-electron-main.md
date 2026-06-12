# Use Drizzle with better-sqlite3 in Electron main

qa-scribe will access SQLite from the Electron main process using Drizzle ORM with `better-sqlite3`. This keeps persistence out of the renderer, gives the app a typed schema and migration path in TypeScript, and fits the relational shape of Sessions, Entries, Evidence, Findings, Drafts, AI Runs, and attachments.
