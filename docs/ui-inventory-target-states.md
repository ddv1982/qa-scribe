# UI Inventory And Target States

This note anchors the UI cleanup work against the product direction captured in `CONTEXT.md` and the historical visual upgrade plan in `docs/ui-improvement-plan.md`: qa-scribe should be calm, local-native, capture-first, and minimal by default, with dense testing details available only when they are relevant.

## Current Clutter Inventory

| Surface | Visible control or data | Priority | Target treatment |
| --- | --- | --- | --- |
| Launch state | New Session | Primary | Keep as the only strong launch action. |
| Session Library | Session list | Primary | Keep visible in the sidebar. |
| Session Library | Create Session | Primary | Keep text-labeled or clearly discoverable in the sidebar. |
| Topbar | Session title and optional context | Primary context | Keep, but make it quieter than capture controls. |
| Topbar | Provider status | Secondary status | Keep visible, but compact; details belong in generation/provider context. |
| Topbar | Generate | Primary transition action | Keep easy to find once the Session has a title. Missing optional context should be nonblocking. |
| Topbar | Export MD | Secondary command | Demote behind a more/options or Draft/export area. |
| Topbar | Export JSON | Secondary command | Demote behind a more/options or Draft/export area. |
| Session setup | Title | Required setup | Keep near the top for new/incomplete Sessions; reduce dominance after saved. |
| Session setup | Area, URL, ticket, objective, notes | Optional context | Keep collapsed unless already populated or explicitly opened. |
| Session setup | Environment, Build, Related Reference | Optional setup | Keep collapsed unless already populated or explicitly opened. |
| Session setup | Autosave status | Secondary status | Keep quiet and near the form it describes. |
| Session setup | Save Session icon | Secondary/manual fallback | Keep reachable but low emphasis because autosave is the default. |
| Mode tabs | Capture | Primary mode | Capture should be the default and visually dominant. |
| Mode tabs | Generation | Secondary mode | Remove from default tabs; enter only from the explicit Generate action. |
| Mode tabs | Output | Secondary mode | Keep available for Draft review; should show rendered output first. |
| Capture tools | Search Entries | Secondary utility | Keep compact; avoid competing with composer. |
| Capture tools | Filter by Entry type | Secondary utility | Keep compact; pair with search. |
| Capture tools | Add Evidence | Contextual/secondary | Prefer entry/session context or inspector; keep reachable without top-level dominance. |
| Timeline empty state | Empty message | Primary guidance | Keep concise and point toward the composer. |
| Timeline Entry | Select Entry | Primary interaction | Keep entire Entry keyboard and pointer selectable. |
| Timeline Entry | Create Finding | Contextual action | Show on hover/focus or selected Entry; duplicate in inspector. |
| Timeline Entry | Add Evidence | Contextual action | Show on hover/focus or selected Entry; duplicate in inspector. |
| Timeline Entry | Include/exclude from generation | Contextual action | Keep contextual; show state in Entry footer without making it noisy. |
| Timeline Entry | Delete Entry | Contextual/destructive | Hide until hover/focus/selection and keep an accessible label. |
| Composer | Note/Finding mode toggle | Primary capture choice | Keep directly above composer fields. |
| Composer | Note title | Secondary field | Keep compact and optional. |
| Composer | Rich-text note body | Primary capture field | Make reliable and visually calm; body input is the center of capture. |
| Composer | Finding fields | Primary when in Finding mode | Keep structured but reduce visual weight of optional fields where possible. |
| Composer | Entry/Finding count | Secondary status | Keep quiet or move near timeline heading. |
| Composer | Add Note/Add Finding | Primary action | Keep text-labeled and visually clear. |
| Inspector | Inspector title | Structural label | Keep only if the panel is visible; avoid showing empty decoration. |
| Inspector | Entry metadata | Contextual detail | Show when an Entry is selected. |
| Inspector | Create Finding / Attach Evidence | Contextual actions | Show for selected Entry. |
| Inspector | Session attachment/finding counts | Secondary detail | Show in Session context only if the inspector is open or useful. |
| Inspector | Delete Session | Destructive secondary | Keep away from primary capture path; require deliberate discovery. |
| Drafts | Draft title | Primary reading context | Keep above rendered Draft. |
| Drafts | Raw textarea | Secondary/edit mode | Replace textarea-first with rendered reading view and explicit Edit. |
| Drafts | Copy Report | Secondary output | Keep visible but less dominant than reading. |
| Drafts | Save Draft | Secondary/manual fallback | Keep near edit controls; autosave remains visible. |
| Drafts | Jira Bug Drafts | Secondary structured output | Keep copy-friendly and visually separate from the report body. |

## Target States

### No Session

- Center pane shows a minimal qa-scribe introduction and one primary `New Session` action.
- Session Library remains visible if it has saved Sessions; otherwise it should not compete with the empty state.
- No provider, export, inspector, or generation controls appear because there is no active Session.

### New Or Incomplete Session

- The title is the only required setup field.
- Capture remains visible and usable immediately; Generate Testware only redirects when the title is missing.
- Optional metadata is collapsed unless populated.
- Export and provider details are secondary; they should not be in the primary command row.

### Active Capture

- Session Timeline and composer are the strongest visual anchors.
- Search, filter, evidence import, provider status, autosave, and counts are compact secondary utilities.
- Entry-level actions appear on hover, focus, or selection and remain keyboard reachable.
- Inspector either shows selected Entry context or stays visually quiet enough that it does not compete with capture.

### Generation Review

- Generate leads to a compact preflight step that explains what will be used before any provider call.
- Provider/model/reasoning controls are available under AI options, not permanently dominant in capture or the default preflight.
- Excluding Entries and attachments is treated as optional review work under Review material, not general timeline clutter.
- Generation progress must prevent duplicate submission and preserve the reviewed context.

### Settings

- AI providers and the generation system prompt are visible by default.
- Capture template customization is advanced and disclosed only when requested.
- Settings copy should reinforce that ordinary capture and generation work without template tuning.

### Draft Review

- The Session Report Draft opens as a rendered, readable document first.
- Edit, save, copy report, copy Jira bug draft, and export are explicit secondary actions.
- Raw Markdown editing is available on demand without making export the primary way to read output.
- Long Drafts, Jira sections, code blocks, lists, and tables remain readable in-app.

## Desktop Expectations

- Preserve the sidebar-first model: Session Library on the left, active workflow in the center, contextual inspector on the right when useful.
- The center column should prioritize writing and reading, not equal-weight cards.
- Right inspector content must be tied to the selected Entry, Draft, or generation step; empty Session metadata should not look as important as active capture.
- Top-level command rows should have one primary action at a time, with secondary actions demoted into compact controls or contextual regions.

## Mobile Expectations

- Use a single-column workflow order: Session context, required setup if needed, active mode content, composer, then contextual details.
- Keep `New Session`, the title field, optional context, composer input, and Add Note/Add Finding reachable without horizontal scrolling.
- Convert sidebars/inspectors into stacked or collapsible sections instead of shrinking three columns.
- Entry actions must remain reachable by focus/tap even when hover is unavailable.

## Visual And Accessibility Constraints

- Use existing semantic CSS tokens and system font stacks.
- Keep the palette restrained; reserve accent and semantic colors for selection, primary actions, status, and risk.
- Do not introduce decorative nested cards or generic dashboard panels.
- Preserve semantic buttons, field labels, visible focus states, and status text that is not color-only.
- Respect reduced-motion preferences for any reveal/collapse transitions.
- Validate meaningful UI changes with desktop and mobile visual evidence when the app can run locally.
