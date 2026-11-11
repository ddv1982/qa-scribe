# Professional UI and dependency refresh

## Direction and research

QA Scribe is an operational testing notepad. Keep navigation compact and the
editing surface comfortable. Refine the existing Inter typography, 4px spacing
scale, React components and CSS tokens instead of introducing a UI framework.

Source inspection found excessive desktop framing/elevation, blue-tinted chrome,
inconsistent selected/hover treatments, weak placeholder contrast, and a hidden
primary creation action below 480px.

- Exa: [Fluent 2 layout](https://fluent2.microsoft.design/layout). Use proximity,
  consistent alignment and a 4px spacing ramp to group related controls. Reflow
  controls as the window narrows rather than hiding necessary actions.
- Exa: [Material density](https://m2.material.io/design/layout/applying-density.html).
  Compact repeated navigation/list elements, but retain comfortable editing,
  dialogs and focused task controls. Density should be consistent, not indiscriminate.
- Ref: [Interaction states](https://tailwindcss.com/docs/hover-focus-and-other-states#prefers-color-scheme).
  Preserve keyboard-visible focus, ARIA selection styling and reduced-motion
  support; use coarse-pointer sizing where appropriate. These CSS principles
  apply to the existing plain CSS; Tailwind is not a dependency of this work.

## Checklist

- [x] Inspect the UI, dependency inventory, repository gates and Dependabot PR;
  obtain Exa/Ref research and an advisory Flow plan.
- [x] Capture unchanged native desktop/narrow screenshots in both themes and
  demonstrate a new contrast regression check failing before styling edits.
- [x] Refine shared light/dark tokens, shell, editor/control hierarchy and
  selection states; keep primary creation actions available at narrow widths.
- [x] Inspect matched screenshots and verify creation, Note editing, record
  navigation, Settings and a dialog; pass focused UI checks and `bun run verify`.
- [x] Refresh compatible same-major frontend packages and all three verified
  cargo-binstall v1.25.1 action pins; preserve security overrides and WDIO pins.
- [x] Pass workflow lint, native E2E/UI regression and `bun run verify`; record
  resolved updates, intentional holds and Dependabot retirement readiness.

## Verification and boundaries

Canonical Linux gate: `bun run verify`, as documented in README/package.json.
Focused UI checks: `bun run frontend:check` and
`QA_SCRIBE_E2E_SPEC=ui-polish.e2e.mjs bun run e2e`.
Dependency checks additionally include `node scripts/check-workflows.mjs` and
`bun run e2e`.

Capture actual native viewport dimensions, including desktop and the E2E
configuration's 640px minimum-width window. Production permits 320px; the
captured matrix does not verify widths below 640px. Do not label screenshots as phone
emulation. Preserve product terminology, data behavior and reduced-motion
support. No major tooling migration or release publication is included.

PR [#28](https://github.com/ddv1982/qa-scribe/pull/28) targets `main`; this checkout
is `release/v0.7.22`. GitHub confirms cargo-binstall tag v1.25.1 resolves to
`7bebc2e59eb8820162b7ac8f62a92bfdb2732447`. Incorporating it locally does not
supersede the PR until the replacement reaches `main` with passing checks.
The unrelated `disk-cleanup-plan.md` is outside this scope.

Baseline evidence: `artifacts/ui-polish-before/` contains 21 native captures at
1280×860 and 640×860 in both themes. The tightened contrast gate failed on all
ten tertiary-text/surface pairings (light 2.85–3.23:1, dark 3.60–4.38:1).
Screenshots show breadcrumb/tab competition and an unnecessarily tall narrow
header. The initial E2E geometry failure followed WebDriver scrolling a Record
into view; normalize capture scroll position before assessing header reachability.

Implementation check: `bun run frontend:check` passed, including 54 contrast
pairings (no skipped pairings). The first post-change native UI run passed
creation, persisted Note/Record edits, theme selection, dialog focus/return and
page-width checks at both actual viewport widths. Subsequent capture setup
returns to page/workspace origin to avoid cropped comparison images.

Gate prerequisite amendment: the first `bun run verify` stopped at the existing
high-severity paste-XSS advisory in transitive prosemirror-view 1.41.9 and the
source-map-js 1.2.1 DoS advisory. Add compatible patched overrides for
prosemirror-view 1.42.6 and source-map-js 1.2.2, preserving the other security
overrides, before rerunning the unchanged gate. Broad upgrades remain step two.

UI verification: `bun run verify` passed after the prerequisite repair, including
316 frontend tests, Rust tests/build/smoke and 54 contrast pairs. Two existing
live-provider Rust tests require authenticated external CLIs and remain ignored.
The final UI E2E passed at 1280×860 and 640×860 in both themes. Inspected Note,
Testware, Settings and command-palette screenshots in `artifacts/e2e/` against
`artifacts/ui-polish-before/`: calmer neutral chrome, complete workspace tabs,
compact header, clear selection and readable content; no page-width overflow.
The full token check is not a comprehensive accessibility audit of mixed colors.

Validation prerequisite amendment: a later unchanged gate rerun had 59 frontend
failures beginning with timeouts and cascading mock-state/act errors under host
load. [Ref: Vitest maxWorkers](https://vitest.dev/config/maxworkers) documents
that non-watch runs default to all available parallelism. Bound JSDOM workers
to two; preserve the full 316-test discovery, assertions and timeouts, then
verify with the unchanged gate. Earlier passing output remains historical.

Independent UI review passed. Advisory `ui-polish.R17-01`: some baseline
Testware/Settings captures have a different scroll origin; those comparisons
are not pixel-aligned. Note comparisons and current normalized captures support
the UI assessment. Keep normalized capture setup for future baselines.

## Dependency updates

`bun update` in `frontend/` refreshed compatible declared ranges and their
transitive resolutions. [Ref: Bun update rewriting](https://github.com/oven-sh/bun/blob/main/docs/pm/cli/update.mdx?plain=1#L29#how-package-json-is-rewritten)
explains that range operators are preserved and exact pins are retained.

- React/React DOM and types: 19.3.0.
- Coordinated Tiptap packages: 3.32.0.
- Tauri JavaScript API: 2.12.3; DOMPurify: 3.4.17; Lucide: 1.56.0;
  Inter Variable: 5.3.0.
- Vite: 7.3.7; ESLint: 10.12.0; typescript-eslint: 8.71.2;
  Testing Library compatible updates and React Refresh: 0.5.7.
- All three cargo-binstall workflow pins: verified v1.25.1 commit SHA above.
- Retain WDIO 9.32.0 and native Tauri service/plugin 1.2.0 pins, security
  overrides, Vitest 4, TypeScript 6, production Vite 7 and plugin-react 5.
  Vitest's existing range now resolves a nested Vite 8.3.4 test dependency;
  both test and production build paths passed. Major direct tooling
  migrations and coordinated Rust/native-driver upgrades are outside this pass.

GitHub recheck: PR #28 remains open targeting `main`; its CI workflow blob
`5c151531a2aafd9b71095bb0398c64ceefe00437` still contains the older action pin.
The local replacement is ready for validation, but remote retirement must wait
until these changes are integrated into `main` and applicable CI passes.

Dependency verification passed: `bun run verify` (316 frontend tests, 367 Rust
tests, 122 release-script tests, builds/smoke, contrast and audits),
`node scripts/check-workflows.mjs`, all five isolated critical native E2E
scenarios, and the 21-capture UI scenario in both themes/widths. Post-update Note
and narrow Testware captures were visually inspected. Frontend audit reports no
high-severity findings (one below the configured threshold); the Rust audit
registry retains its ten previously reviewed findings. Two live-provider tests
remain intentionally ignored because they require authenticated CLIs.

`bun outdated` confirms every package's compatible Update column equals its
Current version. Deliberate holds also include JSDOM 29, jest-dom 6 and exact
YAML 2.9.0 alongside the native-driver pins. No unchecked implementation units
remain. Changes are local and uncommitted; PR #28 and its branch are retained
until integration into `main` makes retirement valid.
