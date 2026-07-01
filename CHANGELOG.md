# Changelog

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
