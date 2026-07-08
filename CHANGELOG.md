# Changelog

## v0.7.5 - 2026-07-08

- Preserve pending Note, Draft, and Finding edits across Session switches, new Session creation, and desktop window close.
- Sanitize AI-generated rich HTML before storage and persist generated Drafts, Findings, note summaries, evidence links, and AI Run completion atomically.
- Bound concurrent AI jobs, clean up provider probe and login-shell child process groups, and keep release validation working on fresh runners by building the frontend before checking Tauri command bindings.
- Polish rich editor accessibility semantics and keep record badge colors on semantic CSS tokens.

## v0.7.4 - 2026-07-08

- Preserve pending Note, Draft, and Finding edits across Session switches, new Session creation, and desktop window close.
- Sanitize AI-generated rich HTML before storage and persist generated Drafts, Findings, note summaries, evidence links, and AI Run completion atomically.
- Bound concurrent AI jobs, clean up provider probe and login-shell child process groups, and add release validation guards for Cargo.lock drift, bindings, frontend checks, and checkout credentials.
- Polish rich editor accessibility semantics and keep record badge colors on semantic CSS tokens.

## v0.7.3 - 2026-07-07

- Keep startup bounded as data grows by skipping full current-schema foreign-key scans while still validating migrations before stamping the schema current.
- Add bounded startup commands for recent Sessions and active Note state, then boot from `listRecentSessions(50)` and `openSessionNoteState` instead of hydrating the full Session Library.
- Load Draft and Finding bodies only when their views or creation flows need them, with stale-load guards that preserve generated records and safe Session switching.

## v0.7.2 - 2026-07-06

- Close the remaining review findings on current main: enforce safe attachment relative paths for all core callers, keep note title autosave from applying stale saves, and allow Finding kind and metadata edits after creation.
- Surface Finding type and metadata JSON controls in the shared rich-record editor while preserving failed-save retry behavior for Drafts and Findings.
- Regenerate Tauri command bindings, update release metadata to 0.7.2, and keep the Linux release metadata in sync.

## v0.7.1 - 2026-07-06

- Protect in-progress note edits from late AI summary completions, keep failed generation undo saves dirty so they can retry, and cover active AI job recovery in the Tauri bridge tests.
- Preserve rich editor bodies while older databases migrate through rebuilt Entry, Finding, and Draft tables, and reject oversized clipboard image data URLs before decoding them into memory.
- Move the largest inline Rust unit-test blocks into sibling unit-test modules, document when to keep tests inline versus split them, and align the broad verify gate with frontend check and release metadata coverage.

## v0.7.0 - 2026-07-06

- Rework the AI generation prompts for testware, findings, and note summaries around current prompt-engineering best practices: the selected note is now clearly separated from the instructions as source data, the required output format is stated as rules the model cannot override, each action shows a worked example of the shape to produce, and the critical constraints are restated after the note so they are not lost behind a long note.
- Treat the selected note strictly as material to transform rather than as instructions, so text inside a note can no longer redirect what the AI produces.
- Wrap each generation's output in a unique per-run marker and extract only what is inside it, so any preamble or sign-off the provider adds around the result is dropped cleanly instead of ending up in the note.
- Run each provider CLI in its own throwaway working directory that is created fresh and removed afterward, so unrelated project files in whatever folder the app was launched from can no longer influence a generation and concurrent generations cannot collide.

## v0.6.3 - 2026-07-05

- Harden AI generation records so successful provider output cannot leave a completed AI Run without its generated Draft, Finding, or Note update, and make AI action Generation Contexts reflect only the selected prompt material.
- Close provider-process edge cases by killing children registered after cancellation and creating provider-probe output files exclusively instead of truncating existing temp paths.
- Guard late generated Draft/Finding saves after Session switches, protect dirty notes during window close, and expose selected theme/navigation state to assistive technology.
- Fix APT prerelease version ordering and refresh release/UI documentation so current validation and release automation are accurately described.

## v0.6.2 - 2026-07-05

- Replace the app icon with a cleaner QA Scribe notebook-and-pencil mark, regenerating the macOS dock and Linux launcher icon assets from the new 1024px source.

## v0.6.1 - 2026-07-03

- Remove a strip of dead vertical scroll below the window by containing the framed layout's margin, so empty states and short views no longer scroll past their content.

## v0.6.0 - 2026-07-03

- Rebuild the interface on a semantic design-token system with distinct light and dark palettes, replacing scattered hardcoded colors so both themes are first-class rather than one inverted from the other.
- Redesign dark mode with a luminance-stepped surface hierarchy and hairline borders for depth, and retune accent and status colors so nothing glares or washes out.
- Bundle the Inter Variable typeface and move all text onto a consistent type scale, spacing onto a 4px grid, and controls onto standard heights, with a slimmer top bar that gives content more room.
- Complete interaction states across every control — hover, focus, active, and disabled — with tokenized motion that respects the reduced-motion system preference.
- Polish surfaces with animated dialogs, blurred backdrops, elevated cards, and designed empty states, and make the top-bar action follow the active view instead of always offering "New note".
- Enforce the new visual system in CI with checks that forbid raw colors outside the token file and verify WCAG contrast for every text-on-surface pairing in both themes.

## v0.5.0 - 2026-07-03

- Harden AI generation end-to-end: fix provider process deadlocks, zombie leaks, and cancellation, add a generation watchdog, and recover still-running generation jobs after a window reload.
- Fix Copilot CLI generations by passing the prompt on stdin (the previous invocation silently discarded session content), and fix the link editor on macOS with an inline popover replacing the non-functional browser prompt.
- Make schema versioning real: gated migrations, cascade foreign-key indices, rejection of databases created by newer app versions, attachment integrity verification on read, and character-based validation limits for multibyte text.
- Generate frontend command bindings from Rust through tauri-specta with a drift check, replacing hand-maintained types and fixing a silent event-field mismatch.
- Delete roughly a third of the unused command surface (including unwired session export) plus Electron leftovers, and consolidate duplicated HTML, storage, provider-detection, and view logic.
- Keep editor keystrokes fast with memoized derivations, make dialogs native and keyboard-accessible, and adopt type-checked linting.
- Harden release automation with an APT monotonic-version guard, signed checksums for all release assets, an Intel macOS build check, and prebuilt Tauri CLI installs.

## v0.4.24 - 2026-07-02

- Harden release automation by pinning external GitHub Actions, scoping signing secrets to first-party steps, and preventing published release drafts from being reset.
- Gate APT publication on both macOS and Linux packaging success, replace parallel release-upload actions with `gh release upload`, and centralize CI/release validation.
- Reduce local gate rebuilds, preserve macOS app symlinks during packaging, share Linux package metadata parsing helpers, and avoid retrying deterministic notarization rejections.

## v0.4.23 - 2026-07-02

- Prevent invalid Session Report Draft generation requests from creating Generation Context or AI Run records.
- Strengthen CI and release validation with explicit frontend lint and test gates before packaging.
- Harden provider probing, rich-record actions, and Debian archive handling with shared code and regression coverage.

## v0.4.22 - 2026-06-25

- Restore reliable image paste in note editors by reading image files from both clipboard files and clipboard items.
- Add a native Tauri clipboard image fallback for WebView paste events that expose image metadata but no DOM `File`, while keeping normal text and HTML paste behavior untouched.
- Keep the existing attach-image path unchanged and add regression coverage for paste files, item-based paste, native fallback, command mapping, and PNG data URL encoding.

## v0.4.21 - 2026-06-25

- Split oversized maintained source and test files into focused Rust, Tauri, frontend, and integration-test modules while preserving public command names and app behavior.
- Add code-size guidelines based on external line-count guidance and document the post-split threshold result.
- Harden save behavior, command bridge drift coverage, terminal job retention, and selected-note validation from the quality improvement pass.

## v0.4.20 - 2026-06-25

- Fix desktop-launched provider detection by sharing mode-aware executable path resolution across provider readiness checks.
- Expand CLI discovery for common Linux and developer-tool installs including Linuxbrew, pnpm, nvm, asdf, mise, cargo, Volta, Bun, and local bin paths.
- Keep app boot responsive with fast provider status first, then refresh deeper shell-aware provider status in the background.
- Show the resolved provider executable path in Settings to make Codex, Claude Code, and Copilot CLI diagnosis visible.
- Add regression coverage for fast-miss/deep-success provider readiness, fallback path coverage, executable resolution, and Settings path display.

## v0.4.19 - 2026-06-24

- Add GitHub Actions CI and release automation for Rust, frontend, macOS notarized DMGs, Linux packages, and GitHub Pages APT publishing.
- Add Tauri release metadata, app identity, macOS entitlements, Linux desktop/metainfo packaging assets, and release validation scripts.
- Replace the placeholder blue-square app icon with a QA Scribe notebook/checkmark icon and generated macOS/Linux icon assets.

## v0.4.18 - 2026-06-24

- Prevent unavailable AI providers from being selected as the Settings AI default while preserving stale saved defaults as disabled options.
- Add regression coverage for unavailable provider filtering, disabled defaults, model switching, and no-provider controls.
