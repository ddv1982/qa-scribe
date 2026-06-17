# Configure AI through local CLI state and application settings

qa-scribe uses already-authenticated local CLI providers for AI generation and does not store API keys in its own database.

Application settings now persist non-secret AI and capture preferences in SQLite:

- which detected CLI providers are selectable for generation
- the user-editable system prompt used as the first generation instruction block
- Note and Finding capture template fields and supported field types

Environment variables remain limited compatibility inputs. `CLAUDE_MODEL`, `CODEX_MODEL`, and `COPILOT_MODEL` can still influence default model selection when present, but provider credentials and API keys stay outside qa-scribe.

This keeps capture usable without AI, makes provider calls explicit, preserves the local-first privacy boundary, and avoids introducing app-managed secret storage while still giving users durable control over generation and capture workflows.
