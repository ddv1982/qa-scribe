# Use Electron for the desktop shell

Superseded by [ADR 0007](0007-use-electrobun-for-the-desktop-shell.md).

qa-scribe will use Electron for its desktop shell instead of Tauri. This favors a TypeScript/Node main process that can run the AI SDK and own provider calls, SQLite access, attachments, and environment-variable configuration without introducing a Rust-to-TypeScript or sidecar boundary for the app's core AI workflow.
