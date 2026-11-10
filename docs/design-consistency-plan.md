# Design consistency and app icon plan

Goal: one visual and interaction language across the Note, Test cases, Findings,
libraries, Settings, and every Ask AI surface, plus a new app icon and favicon.

Scope is this file. Anything not named here is out of scope.

## Evidence used for this plan

Revision 2 drives the real app in a browser instead of relying on
screenshots alone.

- **Live frontend.** The current `main` frontend was served by Vite and opened
  in a Chromium preview. `@tauri-apps/api/mocks` stood in for the Rust
  backend and answered with the existing unit-test fixtures
  (`src/test/fixtures.ts`, `app/useSessionChat.testSupport.ts`). The harness
  lived in the git-ignored `frontend/node_modules/.qa-harness/` and is not
  committed. The surfaces exercised were: Note, Note + Ask AI, Test cases,
  Test case + Ask AI, Findings, and Settings in light mode at 1280 px, plus
  the Note in dark mode at 640 px. Button sizes were read with
  `getBoundingClientRect` and `getComputedStyle`.
- **Rendering caveat.** The packaged app renders with WebKitGTK, not Chromium,
  so font rasterisation can differ slightly. Layout, sizes and component
  choices are the same code.
- **Computer use.** It is not available in this session (no computer-use
  tools), so the native Tauri window itself was not driven.
- **Other sources.** The e2e captures in
  `docs/design/ui-redesign/implemented/*.png` from #110/#111, and the source.
- **Local setup fix.** `frontend/node_modules` was missing
  `@fontsource-variable/bricolage-grotesque`, which is listed in
  `package.json`. `bun install --frozen-lockfile` restored it. No tracked file
  changed.

## Findings (inventory)

"Live" means seen or measured in the running frontend. "Capture" means seen
only in the e2e PNGs. "Code" means read from source.

| Code | Surface | Inconsistency | Evidence | Source |
|---|---|---|---|---|
| F1 | Note action bar | "Create finding" / "Create test cases" use the bordered `secondary` variant. "Ask AI" / "Summarize with AI" use the borderless `quiet` variant, with a divider between the pairs. With Ask AI open at 1280 px the bar wraps and "Summarize with AI" sits alone on a second row. At 640 px it becomes a 2x2 grid that mixes both styles. | Live | `views/SessionEditorView.tsx:190-201`, `styles/editor.css:234-390`, `styles/responsive.css:232-245` |
| F2 | Note action bar | "Summarize with AI" draws its own icon and spinner instead of using `ActionButton`'s `icon` / `loading` props, so its icon slot and busy state differ. | Code | `SessionEditorView.tsx:197-200` |
| F3 | Ask AI entry points | On the Note, Ask AI is a `quiet` button in the bottom bar. On a test case or finding it is a `secondary` button in the record toolbar. Same action, two looks, two places. Neither shows a pressed state while its panel is open. | Live | `SessionEditorView.tsx:193`, `RecordCollectionView.tsx:337` |
| F4 | Ask AI panel | The notes panel stacks "Unsaved changes", a native "Conversation options" disclosure, the transcript, "Review saved conversation" plus a paragraph, and a handoff paragraph plus "Add conversation to note", each with a separator. The two paragraphs largely repeat each other. The record panel has only header, context, transcript and composer. The two panels share the header and composer but not the body rhythm. | Live | `app/AppChat.tsx:36-110`, `SessionChatView`, `styles/ask-ai.css` |
| F5 | Ask AI transcript and composer | Messages are plain "You" / "Assistant" blocks divided by rules, with a "Model evidence unavailable" meta line under answers. The composer has a heavy dark 2 px focus ring. A plain `secondary` "Send" sits next to an icon-only attach button, and the hint text sits on the same row. | Live | `SessionChatView`, `components/RunModelEvidence.tsx`, `styles/ask-ai.css` |
| F6 | Session header | The right side shows Autosaved / Copy / Delete on the Note, but the full Session title as plain text on Test cases and Findings. | Live | `app/AppShell.tsx`, `views/RecordCollectionView.tsx` |
| F7 | Tabs | The Note tab keeps its yellow tint when another tab is active, so two tabs look selected. Active tabs use weight 600, inactive 500. | Live | `styles/shell.css`, `styles/editor.css` |
| F8 | Note title | A long Session title is cut off mid-letter at the column edge. At 640 px the title renders at the same visual weight as an H2 in the body ("Setup"), so the hierarchy collapses. | Live | `editor.css` title input |
| F9 | Record toolbar | Ask AI (secondary, 36 px), Copy (secondary **compact**, 32 px), Edit (primary, filled, 36 px), Delete (bare red icon, 36 px). The 32 px Copy is visibly shorter. The filled Edit competes with the filled "Create test cases" / "Create finding" in the same view. | Live, measured | `RecordCollectionView.tsx` |
| F10 | Control sizes | There is no rule for which height a context uses. Settings has Back and Refresh at 32 px but Save at 36 px. The Note header has Copy and Delete at 32 px. Tabs are 28 px. | Live, measured | `styles/controls.css`, `views/SettingsView*` |
| F11 | Selects | Provider and Reasoning are native `<select>` elements. Model is a custom combobox with a separate 36 px chevron button. The record Sort control is a third style (an inline label plus a bare native select). | Live | Settings, `components/ModelSelector.tsx`, `RecordCollectionView.tsx` |
| F12 | Disabled / busy | Idle Settings looks fine (Save settings is a light, dimmed button). The e2e capture shows Back, Save, Refresh, New Session and the "Dark" segment as heavy grey filled blocks, which is likely the busy or loading state. Reproduce it at the start of P5.1 before changing it. | Capture | `styles/controls.css`, `styles/sidebar.css` |
| F13 | Record view + Ask AI | Opening Ask AI on a test case hides the record list, stacks Sort under the search field at full width, and shows two scrollbars side by side (content pane and panel). | Live | `styles/collections.css`, `styles/responsive.css`, `styles/ask-ai.css` |
| F14 | Formatting toolbar | The toolbar starts 8 px left of the text column at both 1280 and 640 px, so it does not line up with the title and body. | Live, measured | `styles/editor.css` |
| F15 | 640 px top bar | The section buttons are 36x36 boxed icons, Help and Settings are 36x32, and the Session switcher is a bare native select. The bar has three different icon-button treatments. | Live | `styles/responsive.css`, `styles/sidebar.css` |
| F16 | Disclosures | "Conversation options", "Execution diagnostics" and "Output templates" use the unstyled native `<details>` triangle, unlike the rest of the iconography (lucide). | Live | `SessionChatView`, Settings |
| F17 | Brand | The app icon is a glossy navy/blue illustration that matches nothing in the warm-neutral + highlighter-yellow UI. `frontend/index.html` has no favicon. The sidebar brand mark is a generic pencil glyph. | Live, code | `build/icons/*`, `build/macos/*`, `src-tauri/icons/icon.png`, `frontend/index.html` |

Not checked live: Findings + Ask AI (the code path is the same as Test
cases), the libraries, Help, the first-use dialog, error and empty states, and
dark mode at 1280. Anything found there later gets a new code before it is
fixed.

## Design rules

These rules replace a mockup round. They are my calls; correct any of them
before the phase that uses it.

- **R1 Heights.** Controls in the session header row (tabs, Autosaved, Copy,
  Delete) are 32 px. Every other button is 36 px: action bars, page headers,
  record toolbars, Settings, the Ask AI header and composer. Formatting-toolbar
  icons inside the editor stay at 28 px. No `compact` buttons are left outside
  the header row. (F9, F10)
- **R2 Variants.** One `primary` per view: the create action in the page
  header ("Create test cases" / "Create finding" / "New Session"). Everything
  else in a toolbar or action bar is `secondary`. Delete stays
  `destructive-quiet` icon-only. Record "Edit" becomes `secondary`, and the
  `quiet` variant goes away in the Note action bar. (F1, F9)
- **R3 Ask AI trigger.** It is always `secondary` with the Sparkles icon and
  the label "Ask AI", and shows a tinted open state (`aria-expanded`,
  which the Note trigger already exposes) while its panel is open. It sits in the Note action bar and in the record
  toolbar, as it does today, but looks the same in both. (F3)
- **R4 Tabs.** Tint and weight 600 apply only to `aria-selected`. Inactive
  tabs are untinted and weight 500, the Note tab included. (F7)
- **R5 Session header right side.** It holds only that tab's own actions. The
  duplicated Session title on Test cases and Findings is removed, and the
  search scope moves into the search placeholder ("Search test cases in this
  Session…"). (F6)
- **R6 Ask AI panel.** One shell: header, context line, transcript,
  composer.
  - Your messages appear as tinted bubbles aligned right. Assistant messages
    sit plain on the left.
  - The model meta line is tertiary text and is hidden when it says
    "unavailable".
  - The notes handoff becomes one block with one sentence and the two
    buttons ("Review saved conversation", "Add conversation to note").
  - "Unsaved changes" and "Conversation options" fold into a single header
    menu.
  - The composer is one bordered box with attach and send inside it, using
    the standard focus halo instead of the 2 px dark ring. (F4, F5)
- **R7 Selects and disclosures.** Native selects share one styled look (36 px,
  border, lucide chevron), and the Model combobox matches it visually.
  Disclosures use a rotating lucide ChevronRight. (F11, F16)

## Phases

Each phase ends with a check whose output is shown, then stops for your
review. Nothing is committed before its check has run. Checks are the
existing tests and `frontend:check`, plus a look at the affected screens in
the running frontend. No screenshot tooling is added to the repository.

### Phase 1: control system and action bar

- [x] P1.1 Write failing tests for R1-R3: all Note actions are `secondary`, Summarize uses `icon`/`loading`, record toolbar buttons share one size, and Ask AI exposes `aria-expanded` while its panel is open.
- [x] P1.2 Apply R1 and R2 to the record toolbar, Note header and Settings (F9, F10).
- [x] P1.3 Rebuild the Note action bar so it stays on one row with Ask AI open at 1280 px and forms a clean grid at 640 px (F1, F2).
- [x] P1.4 Apply R3 to both Ask AI entry points (F3).

Check: frontend tests, `frontend:check` (lint, CSS color lint, contrast), and a look at the Note and record views at 1280 and 640 px.

### Phase 2: Ask AI panel

- [x] P2.1 Make one panel shell used by both `ask-ai-panel--notes` and `ask-ai-panel--record` (R6).
- [x] P2.2 Restyle the transcript, meta line and composer, and merge the handoff copy, without changing behaviour (F4, F5).
- [x] P2.3 Fix the record view with the panel open: list stays visible, filter row stays on one line, single scroll region (F13).
- [x] P2.4 Keep the existing Ask AI unit and e2e tests green, adjusting selectors only where markup moved.

Check: frontend tests, the Ask AI e2e specs (CI), and a look at all three Ask AI surfaces in both themes.

### Phase 3: header, tabs, title, toolbar

- [x] P3.1 Apply R4 (F7) with an accessible focus ring.
- [x] P3.2 Apply R5 (F6).
- [x] P3.3 The long title wraps instead of clipping, and it stays visually above H2 at 640 px (F8).
- [x] P3.4 Align the formatting toolbar with the text column (F14).

Check: tests, the contrast check, and a look at a long title at 1280 and 640 px.

### Phase 4: Settings, selects, small screens

- [ ] P4.1 Reproduce the heavy grey busy state (F12), then make disabled and busy states dimmed versions of the same control.
- [ ] P4.2 Apply R7 (F11, F16).
- [ ] P4.3 One icon-button treatment in the 640 px top bar (F15).
- [ ] P4.4 Fix any rows added since this revision.

Check: tests, the contrast check, and a look at Settings and the 640 px layout in both themes.

### Phase 5: new icon and favicon

- [ ] P5.1 Draw 2-3 icon concepts as SVG in the app's palette (warm neutral, ink, highlighter yellow; flat, legible at 16 px) and show them at 16, 32 and 256 px. Stop for your pick.
- [ ] P5.2 Commit the chosen SVG as the source in `build/icons/`.
- [ ] P5.3 Generate the 16-1024 px PNGs, `AppIcon.icns` and `src-tauri/icons/icon.png` from the SVG with a checked-in script.
- [ ] P5.4 Add a favicon link to `frontend/index.html` and replace the sidebar brand glyph with the same mark (F17).
- [ ] P5.5 `bun run release:check` passes (it validates the Linux icon set).

Check: the release check output, the generated icons at 16, 32, 128 and 512 px, and a look at the sidebar brand.

### Phase 6: close-out

- [ ] P6.1 `bun run verify:fast` and the frontend tests pass.
- [ ] P6.2 Walk every finding F1-F17 in the running frontend and confirm it is fixed; CI's e2e suite (real WebKitGTK) is green.
- [ ] P6.3 Re-read this file and list every unchecked item with its reason.

## Decisions

- 2026-11-10: R3 uses `aria-expanded`, not `aria-pressed`. The trigger opens a panel and does not toggle it, and existing tests already pin `aria-expanded` on the Note trigger.
- 2026-11-10: "Summarize with AI" is now "Summarize" (busy: "Summarizing"). Four bordered buttons did not fit the 530 px Note column beside Ask AI; the Sparkles icon still marks it as AI. Unit tests, e2e specs and `docs/ai-providers.md` follow the label.
- 2026-11-10: R1 is enforced by `frontend/scripts/check-css-colors.mjs`: `size="compact"` is allowed only in the Session header row and on the image-thumbnail remove overlay.
- 2026-11-10: P2.3 keeps the record list hidden while Ask AI is open. Beside the 454 px panel the record column is about 580 px, too narrow for a list and a readable record; the record under discussion is the focus. The filter row stays on one line instead.
- 2026-11-10: R6 "header menu" became one quiet row at the top of the transcript: the status text on the left and a "Conversation options" disclosure on the right. Moving it into the panel header would mean lifting `SessionChatView` state into `AppChat`, and e2e specs drive `.chat-options summary` in place.
- 2026-11-10: F7 did not reproduce on a fresh load: the inactive Note tab computes a transparent background and weight 500. The tint in the earlier screenshot was the preview cursor's hover. R4 now keys the tint on `aria-selected` and tabs gained a focus ring.
- 2026-11-10: F14 is kept as is. The toolbar's -8 px offset is a deliberate hang so the block-style label, not its invisible box, lines up with the title; the residual is about 5 px of native select padding. Removing the offset would push the label 13 px right of the text column.
- 2026-11-10: The Session title is a one-row `<textarea>` that grows to fit, because an `<input>` cannot wrap (F8). Enter is ignored and pasted newlines become spaces.
- 2026-11-10: Run as "full send". The phase stops and the P5.1 icon pick are made without waiting; the chosen concept and why are recorded here.

- 2026-11-10: No mockup round and no screenshot tooling. Rules R1-R7 above stand in for the design pass. The icon is chosen from concepts in P5.1.
