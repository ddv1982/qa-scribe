# Sidebar and preflight UI improvement plan

Target release: v0.8.7. Preserve unrelated documentation changes. Use existing
design tokens and the native Tauri E2E harness.

## Phase 1: Recent sessions

- [x] Reproduce title clipping with a failing rendered regression covering short, multiline, clamped and unbroken titles in an overflowing list.

Baseline native E2E failed: title height 11px versus line height 18.85px at
1280x860. Eight Session rows were compressed to their 48px minimum.
- [x] Repair local row sizing; verify date separation, two-line truncation, tooltips, selection, keyboard navigation and scrolling with desktop/laptop and narrow screenshots.

Native E2E passed at 1280x860, 1280x720 and 640x860. One-line titles are
18px high and two-line titles 36px, with 4px date spacing. Inspected desktop
and narrow screenshots under `artifacts/e2e`; the narrow layout uses the
existing compact Session selector. The test waits for asynchronous focus
scrolling and accommodates WebKit line-height rounding.

First review found `sidebar-layout.R11-01`: compact-selector coverage selected
the already-active Session. The retry explicitly checks CHO-2982 as the starting
Session and switches to EMP-990, requiring the editor title to change.
- [x] Run `bun run verify` and obtain independent Phase 1 review.

Retry focused E2E and full verification passed; independent review passed at
Flow revision 19. The compact selector uses the maintained embedded-driver
native option value/change-event path and verifies the editor changes.

## Phase 2: Generation preflight heading

- [x] Reproduce the focused heading's input-like appearance with a failing rendered check.

Baseline focused E2E failed with heading outline `auto` instead of `none`;
the 1280x720 screenshot reproduces the reported field-like outline. The local
heading-only focus style preserves initial focus and all control focus styles.
- [x] Apply a local presentation fix preserving initial heading focus, top context visibility, dialog semantics and keyboard behavior; inspect screenshots.

Focused E2E passed: light/dark at 1366x768, 1280x720 and 640x720, plus
Finding and Summary variants. Inspected desktop and narrow screenshots: static
heading with initial focus retained and context at scroll position zero.
Actual dialog handlers wrap Tab/Shift+Tab and restore trigger focus on cancel.
An attempted native-keyboard run could not locate the Wayland app through X11;
the existing native-keyboard workflow remains opt-in, with no OS-key claim for
this host. Control focus styles and dialog logic are unchanged.
- [x] Run frontend tests, existing preflight layout E2E and `bun run verify`; obtain independent Phase 2 review.

520 frontend tests and focused E2E passed. A full-gate code-size failure was
repaired by extracting existing native keyboard/window helpers; all assertions
remain. Full verification then passed, followed by independent review at Flow
revision 32.

## Phase 3: v0.8.7 release

- [x] Create the release branch from current origin/main and use `bun run bump 0.8.7`; populate changelog notes and verify metadata.

Created `release/v0.8.7` from origin/main `797f1b7`, whose tree matches the
previous branch tip. Preserved all existing changes. Version script updated
all release metadata; replaced the expected changelog TODO, and exact-tag
metadata validation passed.
- [x] Run the documented local release checks and final `bun run verify`.

Frozen dependency install made no changes. Workflow validation passed with
actionlint 1.7.12; authenticated zizmor 1.30.1 reported no findings. Full
verification passed on the v0.8.7 candidate, including 520 frontend tests,
Rust workspace tests/build and the smoke harness.
- [x] Review and commit only intended changes; push a release PR and verify hosted CI success.
- [x] Obtain separate merge authorization and merge through the protected branch process.
- [x] Watch the merge-triggered Release run; verify exact automatic tag SHA, non-draft release and expected downloadable assets.

PR https://github.com/ddv1982/qa-scribe/pull/38 at commit `7cc0360` passed all
hosted checks, including CI success, Linux quality/package checks, macOS
platform tests and observational application E2E (run `38839087213`). The user
explicitly authorized merge/publication after green CI. Merged at
`aa6fd4c662353eeff6148c46c0cc036df2c26909`.

Release run https://github.com/ddv1982/qa-scribe/actions/runs/38841039011
succeeded. The workflow created `v0.8.7` at that exact merge SHA. Verified
non-draft publication and eleven uploaded assets: arm64/x64 signed/notarized
macOS DMGs; Linux deb, rpm and AppImage; APT setup deb, checksum and signature;
APT installer; SHA256SUMS and its signature. Platform installer launch checks,
checksum signing/verification and APT Pages publication succeeded.

Release: https://github.com/ddv1982/qa-scribe/releases/tag/v0.8.7

All implementation and publication checklist units are verified. This final
execution record is maintained on the release branch after publication; it
does not move or replace the published tag.
