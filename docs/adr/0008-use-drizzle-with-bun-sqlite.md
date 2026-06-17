# Use Drizzle with Bun SQLite

qa-scribe will access SQLite from the Electrobun host process using Bun's built-in `bun:sqlite` driver with `drizzle-orm/bun-sqlite`.

This removes the native `better-sqlite3` rebuild path while keeping the existing schema, versioned `user_version` migrations, and service-layer ownership of persistence.
