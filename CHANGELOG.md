# Changelog

## v0.7.16 - 2026-07-14

- Discover signed-in Claude Code and GitHub Copilot model catalogs through bounded, no-prompt structured probes, while retaining help-derived and curated fallback choices when a CLI is unavailable or incompatible.
- Add provider-neutral catalog lifecycle, authority, capability, rollout, cache-identity, cancellation, and sanitized-error contracts without turning a discovered provider default into an explicit execution override.
- Surface catalog health and richer model metadata in Settings, preserve custom model entry, and harden the persisted provider cache so paths, credentials, raw diagnostics, and account-specific live catalogs are never replayed across app restarts.
- Document the compatibility matrix and external release gates, with Claude and Copilot selector promotion remaining in diagnostics mode until live account/platform coverage and provider-policy checks are complete.

## v0.7.15 - 2026-07-13

- Overhaul the Session workspace with dedicated Testware and Findings libraries, clearer navigation, a command palette, responsive layouts, and more consistent typography and spacing.
- Make CLI-managed model and reasoning defaults visible and trustworthy with live provenance, cached last-known status, searchable model selection, concise execution previews, and refresh-before-generation safeguards.
- Keep startup fast by deferring deep provider discovery until Settings or generation needs it, while preserving readiness and the last detected CLI configuration across restarts.
- Improve record editing and library navigation, preserve Finding metadata and evidence relationships, and keep long Session titles readable with a clean two-line clamp.

## v0.7.14 - 2026-07-13

- Run the real built-application suite observationally on macOS arm64 through the same isolated, production-restoring CI action used by the required Linux gate.
- Track Linux and macOS reliability evidence independently, require 20 first-attempt passes before macOS promotion, and document the expanded test-only Tauri trust boundary.
- Fix Ubuntu title-bar close requests getting trapped in a recursive close/unload guard after edits, while still saving pending work before exit.

## v0.7.13 - 2026-07-13

- Keep “Use CLI default” transparent during generation instead of re-sending discovered reasoning as a QA Scribe override.
- Stop unsupported configured Codex defaults before a doomed provider run, with actionable guidance to upgrade the CLI or choose an explicit model override.

## v0.7.12 - 2026-07-13

- Discover and display effective model and reasoning defaults from Codex, Claude Code, and GitHub Copilot CLI configuration while keeping QA Scribe overrides independent and explicit.
- Add nullable settings migration, automatic provider refresh, compatibility preflight checks, custom model support, and resolved-model recording for structured provider runs.
- Read Codex defaults through its app-server protocol, support current Copilot JSONC settings and reasoning flags, and preserve honest provider-managed states when a CLI cannot expose its account default.
- Create the version tag and run the signed release pipeline automatically when a version-bumped feature branch is merged into `main`, while retaining tagged release reruns.

## v0.7.11 - 2026-07-12

- Split the frontend app controller into focused startup, record-hydration, and pending-change hooks while preserving autosave, Session switching, generation, and lifecycle behavior with smaller targeted test suites.
- Extract cohesive generation response, prompt-context, and storage-schema modules from the Rust core without changing Tauri command names, database schemas, or product behavior.
- Add an automated contract check that keeps all 31 Tauri commands aligned across the build manifest, handler registration, generated bindings, and permissions.
- Harden CI and releases with reproducible Rust 1.97 tooling, stable aggregate checks, focused cross-platform coverage, read-only release builds, staged artifact publishing, workflow security analysis, and protected-branch release guidance.

## v0.7.10 - 2026-07-09

- Give debug Tauri builds their own `.dev` app identifier, product name, and window title so development runs no longer share the installed app's data directory or look identical in the window switcher.
- Make the Rust build script watch every prebuilt `frontend/dist` file, forcing Tauri binaries to re-embed freshly rebuilt frontend assets instead of shipping a stale UI.
- Bundle the Inter Variable italic face so rich-editor Italic formatting renders slanted with `font-synthesis: none`, and tighten the closed-stdout streaming regression fixture.

## v0.7.9 - 2026-07-08

- Fix rich editor toolbar buttons so mouse clicks preserve the selected text before TipTap formatting commands run, restoring reliable Italic, Bold, list, checklist, link, and image-upload actions.
- Keep block-style and link editing controls usable while safely restoring editor selections after their native inputs receive focus.
- Add regression coverage for Italic output, toolbar focus preservation, block-style changes, link apply/remove flows, and stale selection cancellation paths.

## v0.7.8 - 2026-07-08

- Copy notes for Jira with rich formatting: the clipboard now carries an HTML flavor alongside the plain Markdown fallback, so pasting into Jira keeps headings, bold, links, and lists.
- Replace the hand-rolled editor HTML sanitizer core with DOMPurify while keeping the app's tag allowlist, URL policy, managed-attachment handling, and task-list normalization.
- Serialize Jira clipboard Markdown from the editor document via TipTap's static renderer instead of a custom HTML walker, with pinned output and no format changes.
- Pin sanitizer and clipboard behavior with characterization and golden tests covering XSS vectors, task lists, managed images, and link handling.

## v0.7.7 - 2026-07-08

- Add Rust dependency auditing to the broad local release gate and document it in the release workflow.
- Prevent provider-process cleanup from hanging on blocked stdin writers and reject oversized clipboard image transforms before allocating RGBA buffers.
- Enforce managed attachment paths inside each Session and document/test that `body_format: null` resets rich records to HTML.
- Add keyboard focus navigation for the note picker and AI model listboxes, with regression coverage for keyboard selection.

## v0.7.6 - 2026-07-08

- Preserve dirty Draft and Finding edits during Session refreshes and make Note, Draft, and Finding inline image saves materialize through managed attachments before persistence.
- Harden generated Testware and Findings by validating managed image references, dropping malformed attachment IDs, and capping custom Testware instructions before prompts and metadata are built.
- Tighten release and desktop validation with stable-only release metadata checks, placeholder changelog rejection, explicit Tauri command permissions, Rust dependency auditing, and Windows provider-process tree cleanup.
- Polish Settings accessibility, enforce CSS token resolution, and split frontend bundles so production builds no longer warn about an oversized app chunk.

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
