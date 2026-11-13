# UI standard

Use this page to plan a new screen or change an existing one. The decision
behind it is [ADR 0011](../adr/0011-one-accent-and-shared-components.md).

## Rules

1. **The Note stays the whole screen.** A new feature lives in one quiet row or
   behind an existing tab. Do not add panels or navigation items for it. The
   only panels are the side panels listed below: Ask AI, and the Note beside a
   new draft.
2. **Empty means invisible.** A feature with nothing in it shows nothing.
3. **One component per job.** Compose the shared components below. A screen
   stylesheet lays things out. It does not style a control.
4. **Colour carries meaning only.** Teal is the accent. Green, amber and red
   mean a result or a severity. Yellow is the highlighter that marks where you
   are.
5. **Tokens only.** Every colour, space, radius, size and duration comes from
   `frontend/src/styles/base.css`. `bun run --cwd frontend check` enforces the
   colours and their contrast.

## Tokens

| Need | Token |
|---|---|
| Page, panel, sheet, well, overlay | `--surface-base`, `--surface-panel`, `--surface-raised`, `--surface-sunken`, `--surface-overlay` |
| Text | `--text-primary`, `--text-secondary`, `--text-tertiary` |
| Borders | `--border-subtle`, `--border-default`, `--border-strong` |
| Accent | `--accent`, `--accent-tint`, `--accent-border`, `--on-accent` |
| Result and severity | `--success`, `--warning`, `--danger` and their `-tint` forms |
| Space, on a 4px grid | `--space-1` to `--space-8` |
| Control heights | `--control-sm` 28px, `--control-md` 32px, `--control-lg` 36px |
| Corners | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-full` |
| Type | `--font-size-xs` to `--font-size-3xl`; `--font-display` for titles |

## Focus

- A button, link, tab or checkbox shows a 2px teal ring, and only after
  keyboard use.
- A text field, select or search box turns its own border teal. It has no
  outline and no glow. An invalid field keeps its red border.
- The Note and the Session title show no box. The caret is their focus sign.

## Components

A component is listed as **shared** when screens already import it. The others
are the next ones to extract; until then, copy the named pattern exactly.

| Job | Component | State |
|---|---|---|
| Any action | `ActionButton` in `components/ActionButton.tsx`. Variants: `primary`, `secondary`, `quiet`, `destructive-quiet`, `destructive-confirmation`. One `primary` per screen. | Shared |
| Hover message on an icon-only button | `tooltip` on `ActionButton`: a small label below the button. Set `tooltipAlign="end"` for a button at the right edge. Never use the native `title`. The `aria-label` stays the accessible name | Shared |
| Copy | `CopyControls` in `views/RichRecordView.tsx`: a quiet icon in the top-right corner of what it copies, with a second icon for the first screenshot. It says Copied in its tooltip. `CopyButton` in `components/CopyButton.tsx` is the single icon | Shared |
| Hide or show the record list | `RecordListToggle` in `components/RecordListToggle.tsx`: a quiet icon left of the search box that folds the list away so the open record gets the full width. `useRememberedVisible(recordListStorageKey)` in `hooks/useRememberedVisible.ts` remembers the choice for Test cases, Findings and both libraries. Beside a side panel or a new draft the list is hidden, so the toggle is too | Shared |
| Side panel on the right | `side-panel` with a `side-panel-header` (title, then a close icon), and `session-content--side-panel` on the workspace to fold the record list away. At a workspace width of 850px or less the panel covers the document area until closed. Used by Ask AI beside a saved record and by `CreationNotePanel` in `views/CreationNotePanel.tsx`, the Note read-only beside a new draft, opened and closed through `useCreationNoteVisible` in `hooks/useCreationNoteVisible.ts`. Never both at once: Ask AI is not offered beside a new draft | Shared |
| Empty, loading or failed list | `StatePanel` and `EmptyCollection` in `components/Common.tsx` | Shared |
| Save state line | `StatusPill` in `components/Common.tsx` | Shared |
| Modal dialog | `Dialog` in `components/Dialog.tsx`: native `<dialog>` with `useModalDialog`, title, description, actions on the right. Pass `initialFocus` to focus the safe action first | Shared |
| Labelled field | `Field` in `components/Field.tsx`: a label above the control, with an optional `hint` linked by `aria-describedby` | Shared |
| Select | Native `<select>` inside a `Field`. The shared chevron is applied globally | Shared |
| Tabs | `role="tablist"` with `role="tab"` buttons and `aria-selected` | Pattern, to extract as `Tabs` |
| Small status label | `Badge` in `components/Badge.tsx`: a quiet pill for a short fact such as a format, a timebox or a state | Shared |
| One choice from a few, or none | `Segmented` in `components/Segmented.tsx`: toggle buttons on a sunken track with `aria-pressed`. `allowDeselect` lets the pressed option be pressed again to clear it; a `tone` (`success`, `danger`, `warning`) colours a pressed result. Used by the theme setting and test run results | Shared |

## Adding a screen

1. Sketch it with the components above. If one is missing, extract it first, in
   its own pull request, together with the screens that already need it.
2. Give the screen one layout class. Use `gap` on flex or grid, not margins.
3. Find elements in tests by role and label, not by class name.
4. Check both themes in the running app before you open the pull request.

`bun run --cwd frontend check` fails when a screen uses a raw `<dialog>` or a
retired field wrapper class instead of `Dialog` and `Field`.
