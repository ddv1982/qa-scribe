# Use Electrobun for the desktop shell

qa-scribe will use Electrobun for its desktop shell. The host process runs on Bun, owns SQLite, attachments, provider CLI execution, exports, native file/clipboard helpers, and exposes a typed RPC bridge to the trusted React view.

The renderer continues to consume the existing `window.qaScribe` API through a browser-side compatibility adapter, so React call sites do not need to change during the shell rewrite.
