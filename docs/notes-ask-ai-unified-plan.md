# Notes Ask AI: unified and note-aware

From user screenshots after v0.8.34: the Note's Ask AI panel is cluttered next to
the Test cases / Findings panel, has too many buttons, and does not see the note.

Interpretation: the Note panel should look and behave like the record panel
(header, source, empty-state hint, transcript, composer with Attach + Send), and
every Note conversation turn should carry the current saved note text.

- [x] N1. Root cause shown: Notes chat sends only `sessions.session_context` (empty for app-created Sessions), never the note body.
- [x] N2. Notes conversations send the saved note text (HTML projected to prompt text, bounded to 16 KiB with a truncation marker) as Session context; core unit test fails before and passes after.
- [x] N3. Pending note edits are flushed before a Notes send, so the AI sees what is on screen.
- [x] N4. Panel declutter: remove the Conversation options disclosure, the Draft Jira / Refine record composer buttons, and the always-visible handoff card; keep Start new conversation and Add to note as quiet, single actions.
- [x] N5. Empty state and placeholder match the record panel ("Improve this note").
- [x] N6. Live check at 1280 and 640, light and dark, plus `verify:fast` and `cargo test` for the core crate.
- [x] N7. Sol review, PR, CI green, merged.
- [x] N8. Note edits as reviewable proposals (Update / Undo), designed from the record flow (lean option: frontend applies to the live Note editor):
  - [x] N8a. Core: Notes conversations get a v3 Note refinement contract; an edit outcome carries a whole-note `bodyMarkdown`; Stage marks the proposal Applied (core tests).
  - [x] N8b. Frontend: Suggested note card with Update note; Note updated with Undo while the Note still equals the applied text; refuses to rewrite notes over 15 KiB of text (AppShell test).
  - [x] N8c. Live check in the harness: Update note replaces the Note and autosaves, Undo restores it.
  - [x] N8d. verify:fast, cargo test, Sol review, PR, CI green, merged.
- [ ] N9. Release published.
