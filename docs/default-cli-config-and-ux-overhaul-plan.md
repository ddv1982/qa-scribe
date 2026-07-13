# Default CLI Configuration and UX Overhaul Plan

**Status:** Engineering implementation complete; representative-user benchmark pending

**Date:** 2026-07-13

**Branch:** `codex/default-cli-config-ux-overhaul`

**Baseline:** `main` at `76a760f8` (`v0.7.14`)

## Executive decision

QA Scribe can detect and explain the Codex CLI's current default model and reasoning effort. It should present that data as the **last detected CLI configuration**, including its source, while preserving the existing runtime contract in which Codex resolves the live default when a generation starts.

That distinction is the central UX rule:

- **User intent:** “Use Codex CLI default” or “Use a QA Scribe override.”
- **Last observation:** the value QA Scribe most recently detected, its origin, and when it was checked.
- **Runtime behavior:** what QA Scribe will pass and what the CLI will resolve at execution time.

The broader overhaul should build on the visual foundation already shipped in v0.6.0. The next step is structural: trustworthy application states, session-centered information architecture, scalable record workflows, consistent commands, and adaptive/accessibility behavior.

## Implementation outcome

Phases 0–5 are implemented on `codex/default-cli-config-ux-overhaul`:

- ADR 0010 records the output-ownership, saving, custom-model, staleness, warning, privacy, Finding, and command decisions.
- CLI discovery now exposes explicit lifecycle state, independent model/reasoning provenance, checked time, CLI version, sanitized origins, structured warnings, stale last-good data, neutral execution scope, paginated model discovery, and compatibility fallback behavior.
- Settings, the Session footer, and generation preflight distinguish saved intent, last observation, and runtime delegation without turning a detected default into an override.
- Shared loading, empty, error, retry, Save, Discard, and navigation-protection patterns cover the editable and asynchronous surfaces.
- The shell is Session-centered, with Note/Testware/Findings tabs, actionable context, deep links/history, secondary cross-session libraries, and Session provenance.
- Testware and Findings use searchable, sortable, filterable master-detail workspaces; Findings expose structured tester-facing metadata while preserving unknown metadata.
- A canonical command registry powers visible actions and the searchable keyboard command palette. Settings deep links and contextual AI configuration are supported.
- Expanded, compact, and minimum-width layouts are implemented down to a native 320 px window, including light/dark presentation and accessible names for icon-only controls.

Engineering evidence is green: `bun run verify:fast` passes type checking, lint, the frontend audit, code-size and terminology policies, 160 frontend tests, bindings and Tauri command-surface checks, strict Clippy, and E2E source-isolation checks. `cargo test --workspace` passes 232 Rust tests. The large-fixture startup benchmark (1,000 Sessions, 1,000 entries, 250 active drafts, 250 active Findings, and 2,000 AI runs) records 30 ms cold and 29 ms warm-p50 first paint, with no deep provider refresh on the boot path. A native macOS walkthrough covered the CLI-default flow and searchable model picker, Settings provenance/details and Back navigation, platform-aware command palette, Session navigation, and desktop, intermediate, and compact responsive layouts.

The comparative benchmark with five representative users and the 25% median time/backtracking target remain a post-implementation product-validation activity. They require recruited participants and a controlled v0.7.14 comparison; the automated and structured internal acceptance suite cannot honestly substitute for that evidence.

## What the investigation established

### Default detection is possible today

The backend already launches `codex app-server` and calls:

- `config/read` with configuration layers enabled;
- `model/list` to obtain the catalog default and supported reasoning efforts.

`ProviderDefaultSnapshot` already carries the detected model, reasoning effort, separate origins, a resolution (`configured`, `recommended`, `providerManaged`, or `unavailable`), recommended values, and warnings.

A local protocol probe confirmed the approach against Codex CLI 0.144.1. It detected:

- model: `gpt-5.6-sol`;
- reasoning effort: `xhigh`;
- origin: `~/.codex/config.toml` for both values.

This aligns with the [official Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml), which documents user, project, and profile configuration layers.

### Why the current experience still looks unresolved

1. Startup performs the fast provider probe. Deep default discovery is only performed by a manual refresh or a later readiness check, so the first render can only say “Provider managed.”
2. The selector trigger says only “Use CLI default.” The detected value appears in a separate card, forcing the user to connect the two.
3. The session footer uses the selection sentinel rather than the effective detected value, so it also says “Use CLI default” when more information is known.
4. Discovery has no explicit loading, checked-at, stale, or refresh-failed state.
5. “Effective next run” is calculated from an unsaved settings draft, even though generation uses persisted settings. Before save, the truthful label is “Preview if saved.”
6. String-only warnings are all treated as blocking, even when some should be advisory.

The installed v0.7.12 application reproduced the reported ambiguity. Current `main` has since added CLI-default and effective-value cards, but the data remains disconnected from the controls and first-load lifecycle.

### Detection correctness must precede stronger promises

The current mechanism is viable, but several backend details need tightening before the UI treats a snapshot as trustworthy:

- Model and reasoning need independent provenance. A configured model can coexist with a catalog-recommended reasoning effort, while the current snapshot has only one combined resolution.
- Inspection currently inherits QA Scribe's process working directory, while generation runs from a neutral temporary directory. The two paths can therefore resolve different project configuration layers. `config/read` should receive the same explicit neutral scope used by generation.
- `config/read` and `model/list` are sent together, but the response reader can discard a valid out-of-order response while waiting for the other request ID. Responses must be routed by ID.
- Spawn, handshake, timeout, and schema failures currently collapse into “Provider managed.” Inspection status must distinguish a real provider-managed result from a failed or unsupported inspection.
- `includeLayers: true` returns more configuration than QA Scribe needs. Effective config plus origins remain available without full layers, so discovery should request the minimum data.
- Origin parsing should preserve a sanitized structured source such as user config, project config, profile, managed config, or runtime flag rather than assuming every origin is a file.
- Catalog absence is not proof that a configured default is invalid because hidden models can be omitted from picker results. Default mode should warn and delegate to the CLI, not block the run.
- `model/list` is paginated. It should become the primary catalog source, with `codex debug models` retained only as a compatibility fallback.
- `CODEX_MODEL` is not in the documented stable Codex environment-variable contract. It should not be labeled as an authoritative CLI default.

### Product-level UX findings

- The domain is session-centered, but Sessions, Testware, and Findings are presented as peer global destinations. Output provenance becomes unclear.
- Testware and Findings render as tall card stacks without compact scanning, filters, sorting, grouping, or master-detail navigation.
- Record editing has Save but no Cancel/Revert path.
- Finding metadata is exposed as JSON rather than tester-facing fields.
- Empty and unavailable states often state what is missing without explaining why or offering the next action.
- Search scope and breadcrumbs do not adapt to the active area.
- Narrow layouts stack the desktop shell instead of switching to a compact navigation mode.
- Custom listbox and model-combobox behavior needs an accessibility pass.
- Theme controls, settings, contextual actions, and icon-only commands do not yet form one consistent command model.

## Target default-selection experience

The selected value should be understandable without comparing separate cards.

**Model**

`Use Codex CLI default`

`Codex resolves this at run time. Last detected: gpt-5.6-sol from ~/.codex/config.toml.`

**Reasoning**

`Use model/CLI default`

`Last detected: xhigh from ~/.codex/config.toml.`

**What will happen**

`QA Scribe will not pass model or reasoning overrides. Codex CLI will resolve its live configuration when generation starts.`

When an override is selected, use equally explicit copy:

`QA Scribe override: gpt-5.4. Last detected CLI default: gpt-5.6-sol.`

The UI must always show one discovery state:

| State | User-facing behavior |
| --- | --- |
| Checking | Keep the saved intent visible; show “Checking CLI configuration…” |
| Detected | Show last detected value, home-relative origin, and checked time |
| Provider-managed | Explain that no configured value was exposed and the CLI will decide |
| Refreshing | Retain the previous snapshot, mark it refreshing, and preserve focus |
| Stale after error | Retain the snapshot with its checked time and offer Retry |
| Unresolved | Explain why inspection failed; keep CLI default selectable because runtime resolution still works |
| Unavailable | Keep the saved choice visible, disable execution overrides, and show setup/recovery guidance |

Full executable paths, raw diagnostics, and the command preview belong in a “CLI details” disclosure. Default-origin paths should be home-relative by default.

## Phased roadmap

### Phase 0 — Decisions, contracts, and measurement (implemented; external benchmark pending)

**Goal:** remove the few product ambiguities that would otherwise force rework.

**Scope**

- Define the five critical workflows to benchmark, including first generation, switching session output, editing a finding, recovering from a provider problem, and compact-window use.
- Decide whether Testware and Findings are session-owned, global libraries, or a session view plus a cross-session library.
- Decide whether settings remain explicit-save or move toward autosave.
- Confirm whether free-form custom model IDs remain required.
- Define warning severity (`advisory` versus `blocking`), path privacy, and snapshot staleness policy.
- Record baseline completion time, backtracking, error rate, and qualitative confidence with five representative users or structured internal walkthroughs.

**Exit gate**

- Approved task model and output-scope decision.
- Default-discovery contract and copy matrix reviewed by product, frontend, and backend owners.
- Baseline captured at desktop and compact widths.

**Suggested PR:** documentation/ADR only.

### Phase 1 — Trustworthy CLI-default vertical slice (implemented)

**Goal:** make “Use Codex CLI default” fully understandable everywhere it appears.

**Backend and contract**

- Add a first-class discovery state rather than overloading `providerManaged` to mean “not checked.”
- Give model and reasoning independent effective values, resolution/source, origin, and recommendation fields.
- Return `checkedAt`, CLI version, neutral resolution scope, last successful snapshot, refresh/error state, and structured warnings.
- Use the same explicit neutral working-directory scope for inspection and generation.
- Route JSON-RPC responses by request ID; minimize `config/read` to effective values and origins; sanitize structured origins.
- Page through `model/list` and use it as the main catalog, retaining `debug models` only for older-CLI compatibility.
- Keep the fast startup readiness probe, then schedule default discovery after first paint or when an AI surface is first opened.
- Refresh discovery before preflight when data is absent or stale.
- Preserve the runtime contract: CLI-default intent submits model `"default"` and reasoning `null`; detected values must never become accidental overrides.
- Treat an unadvertised configured default as advisory and delegate validation to the CLI rather than blocking the run.
- Remove `CODEX_MODEL` from authoritative resolution or explicitly label it an unverified QA Scribe hint.

**Frontend**

- Consolidate Provider, Model, Reasoning, and “What will happen” into one full-width **AI execution** section.
- Put the last detected value and origin directly under each default control through associated hint text.
- Use “Preview if saved” for dirty settings and “Next run” only for persisted settings.
- Update the session footer and generation preflight to show the effective observation plus its provenance, never only the sentinel label.
- Retain old data during refresh and stale-on-error; add checked-time and Retry behavior.
- Use polite status announcements for routine discovery/save updates and alerts only for blocking errors.
- Either rebuild the custom model picker to the standard editable-combobox pattern or use a simpler select when custom input is not required.

**Likely code areas**

- `src-tauri/src/commands/providers/{types,defaults,detection,providers,cache}.rs`
- `frontend/src/{bindings.ts,settings/defaults.ts,hooks/useSettingsController.ts}`
- `frontend/src/components/ModelSelector.tsx`
- `frontend/src/views/{SettingsView,SessionEditorView}.tsx`
- `frontend/src/workflows/generationPreflight.tsx`

**Exit gate**

- Every provider/default resolution has explicit copy for checking, detected, provider-managed, stale, unresolved, and unavailable states.
- Default intent still sends `"default"`/`null` in contract tests.
- Inspection and execution resolve from the same working-directory scope, including project-config fixtures.
- Out-of-order, paginated, timed-out, unsupported-schema, and catalog-unlisted responses have explicit tests.
- Keyboard, focus, live-region, and VoiceOver checks pass for discovery and model selection.
- No full home path is shown outside technical details.

**Suggested PRs**

1. Discovery DTO and backend lifecycle.
2. Effective-selection model, settings UI, and copy.
3. Accessible selector, footer/preflight integration, and end-to-end tests.

### Phase 2 — Shared state language and safe editing (implemented)

**Goal:** make the whole application clear about what happened, why, and what the user can do next.

**Scope**

- Create shared patterns for first-use empty, no-results, loading, configuration-required, recoverable error, and blocking error states.
- Require state copy to include the cause and a useful next action where one exists.
- Add Cancel/Revert semantics to explicit-save record editing and protect navigation with unsaved changes.
- Add accessible progress/status announcements for generation, save, refresh, search results, and recovery.
- Normalize readiness, save, and generation status language across the shell.

**Exit gate**

- Every asynchronous/data surface has a documented loading, empty, error, and recovery path.
- Every explicit edit flow offers Save and Cancel/Discard without data loss.
- Automated accessibility tests cover status semantics; keyboard and screen-reader smoke checks pass.

**Suggested PRs**

1. Shared state components and copy catalog.
2. Safe edit lifecycle and navigation guards.
3. Adoption across Sessions, Testware, Findings, Templates, and provider flows.

### Phase 3 — Session-centered information architecture (implemented)

**Goal:** make it obvious which session the user is working in and where generated output belongs.

**Scope**

- Prototype and test two models before implementation:
  1. session workspace tabs for Entries, Testware, and Findings;
  2. global output libraries with persistent session provenance and filters.
- Implement the winning model while preserving a deliberate cross-session path if research supports it.
- Make breadcrumbs actionable and show current session provenance on output records.
- Make search scope explicit and contextual instead of always “Search sessions.”
- Move theme selection out of the prime global action area unless user evidence justifies frequent switching.

**Exit gate**

- First-time users can open a session, locate its Testware/Findings, and return to capture without assistance.
- Median time and backtracking on the benchmark tasks improve by at least 25%.
- Navigation state, focus restoration, deep links, and browser/window history behavior are covered by tests.

**Suggested PRs**

1. Tested prototype and IA decision.
2. Shell/navigation model and routes.
3. Contextual search, breadcrumbs, provenance, and migration polish.

### Phase 4 — Scalable Testware and Findings workspace (implemented)

**Goal:** keep output useful beyond a handful of records.

**Scope**

- Replace the full-card stack with a compact list/master-detail or expandable-row design.
- Add search, filter, sort, grouping, session provenance, and informative result counts.
- Keep rich content in the detail surface while making title, kind, session, status, and modified time scannable.
- Replace Finding metadata JSON with tester-facing fields and align kinds with the documented domain language.
- Standardize contextual actions, destructive-action placement, selection, and bulk-action behavior.

**Exit gate**

- At least 50 records remain navigable at 1280×800 without opening every item.
- Common filtering and editing tasks meet the Phase 0 time/error targets.
- Unsaved detail changes always offer Save, Discard, and Cancel where appropriate.

**Suggested PRs**

1. Record query/view model and structured Finding schema.
2. Master-detail collection workspace.
3. Filters, sorting, keyboard interaction, and scale/performance tests.

### Phase 5 — Unified commands, settings, and adaptive shell (implemented)

**Goal:** make frequent actions fast, infrequent actions discoverable, and the shell usable at every supported size.

**Scope**

- Define a command registry with one canonical name, shortcut, availability rule, and handler per action.
- Power visible buttons, overflow menus, application menus, and a searchable command palette from that registry.
- Add contextual “Configure AI execution…” entry points from the footer and preflight.
- Restructure Settings into stable categories with search/deep links only when the setting count warrants it; support the platform Settings shortcut.
- Introduce expanded, compact, and minimal navigation modes instead of stacking the desktop shell.
- Move secondary document actions into a predictable overflow at constrained widths.
- Finish with visual-coherence tuning on the existing token system rather than replacing it.

**Exit gate**

- Every frequent command has keyboard access and a visible discovery path.
- A target setting can be reached in under ten seconds from both Settings and a relevant context.
- No information loss or horizontal document scrolling at 320 CSS px / 400% zoom.
- Critical workflows pass keyboard-only, VoiceOver, reduced-motion, light/dark, and target-size checks.

**Suggested PRs**

1. Command registry, menus, shortcuts, and contextual entry points.
2. Settings hierarchy and deep links.
3. Adaptive shell modes and overflow behavior.
4. Accessibility and visual regression sign-off.

## Verification strategy

Each phase should ship behind evidence, not only screenshots.

- **Contract tests:** configured, recommended, provider-managed, unresolved, unavailable, stale, override, and default-runtime argument behavior.
- **Component tests:** field descriptions, dirty/saved summary labels, advisory versus blocking warnings, retry, focus preservation, and live regions.
- **Integration tests:** first launch, post-first-paint detection, refresh, stale fallback, preflight, runtime default resolution, and unavailable providers.
- **Scale fixtures:** long session names, 50+ records, long generated content, and every empty/error state.
- **Visual matrix:** 1440, 1100, 760, and 320 CSS px in light and dark themes.
- **Manual accessibility:** full keyboard path and VoiceOver for search/listbox, model selection, dialogs, generation progress, collection editing, and save/error announcements.
- **Usability measures:** completion time, backtracking, errors, and confidence against the Phase 0 baseline.

## Guardrails and non-goals

- Do not pass a detected default as an explicit override; the CLI remains authoritative at execution time.
- Do not expose or parse raw configuration in the frontend when the app-server can return typed, layered values.
- Do not block generation for advisory discovery warnings.
- Do not repeat the shipped token/font/motion overhaul before structural issues are addressed.
- Do not build a command palette before command names and action ownership are normalized.
- Do not lock in session-centered output navigation until the Phase 0 scope decision is tested.
- Keep broad schema migrations and unrelated provider integrations outside the default-selection vertical slice.

## Open decisions

Resolved in [ADR 0010](adr/0010-session-workspace-and-cli-discovery.md): outputs are
Session-owned with secondary cross-session libraries; snapshots use a five-minute
freshness policy; discovery mismatches are advisory; full paths stay inside CLI
details; custom model entry remains; Settings stays explicit-save; and passed or
failed checks remain Testware results rather than Finding kinds.

## Research inputs

The plan combines repository tracing, a local Codex app-server probe, a rendered application audit, Exa research, and Ref documentation lookup. Particularly useful external patterns were:

- [GitLab settings management](https://design.gitlab.com/patterns/settings-management): distinguish defaults from enforced values and explain dependencies.
- [Unity inheritance](https://unityeditordesignsystem.unity.com/patterns/inheritance): show the resolved value and source in context; reveal the resolution order on demand.
- [VS Code settings](https://code.visualstudio.com/docs/configure/settings): distinguish configured values from defaults and provide reset behavior.
- [Adobe React Spectrum autocomplete accessibility specification](https://github.com/adobe/react-spectrum/blob/main/specs/accessibility/Autocomplete.mdx?plain=1#L1#autocomplete-accessibility-specification): standard editable-combobox focus and ARIA behavior.
- [USWDS alert accessibility guidance](https://github.com/uswds/uswds-site/blob/main/_components/alert/guidance/accessibility.md?plain=1#L6#alert-aria-roles): reserve alert semantics for sufficiently urgent content.
- [Atlassian empty-state guidance](https://atlassian.design/foundations/content/designing-messages/empty-state) and [Carbon empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/): explain the state and offer the next useful action.
- [Fluent layout](https://fluent2.microsoft.design/layout), [Fluent accessibility](https://fluent2.microsoft.design/accessibility), and [Windows NavigationView](https://learn.microsoft.com/en-us/windows/apps/design/controls/navigationview): adapt navigation modes as space changes.
- [WAI status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), and [listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/): verification criteria for nonvisual state changes and custom widgets.
- [VS Code command palette](https://code.visualstudio.com/api/ux-guidelines/command-palette) and [Raycast settings](https://manual.raycast.com/settings): consistent commands and contextual entry into configuration.
