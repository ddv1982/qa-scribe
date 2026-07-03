# Changelog

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
