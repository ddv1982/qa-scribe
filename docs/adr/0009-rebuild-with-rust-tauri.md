# Rebuild with Rust and Tauri

qa-scribe will be rebuilt as a Rust desktop application using Tauri 2, a Cargo workspace, a React/Vite frontend, and a fresh Rust-owned SQLite schema.

The current Electrobun/Bun implementation is an MVP and product reference, not a compatibility target. Because qa-scribe is not in active use yet, the rebuild will not migrate existing app data, preserve Drizzle artifacts, or maintain the Electrobun app-data layout.

The target workspace will follow the shape proven in `csv-data-anonymizer`: shared Rust core crate, Tauri shell crate, Vite frontend, explicit command modules, typed frontend wrappers, and scriptable validation gates.

Consequences:

- The Rust core owns domain types, validation, fresh SQLite storage, attachment metadata, export rendering, generation prompt assembly, and provider abstractions.
- The Tauri shell owns windows, menus, app-data paths, native dialogs, clipboard helpers, external URL policy, process spawning, and command registration.
- The React frontend calls a narrow typed command bridge instead of raw native primitives.
- AI generation remains explicit, user-triggered, and based on already-authenticated local providers before any optional local-LLM expansion.
- Historical ADRs about SQLite, managed attachments, explicit AI generation, and local CLI configuration remain product constraints; ADRs about Electron, Electrobun, Drizzle, and Bun SQLite are superseded for the target implementation.
