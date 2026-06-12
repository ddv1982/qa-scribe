# qa-scribe Initial Phased Plan

## Product Vision

qa-scribe is a local-first desktop testing notepad for capturing the messy reality of testing and turning it into useful testware afterwards.

During a Session, testers can quickly collect notes, observations, screenshots, logs, API responses, possible findings, and other evidence in one chronological Session Timeline. After the Session, AI helps transform that raw material into structured outputs such as what was tested, scenarios covered, passed and failed checks, bugs found, reproduction steps, expected versus actual results, evidence references, open questions, follow-up actions, and Jira-ready bug drafts.

The product should optimize for speed during testing, clarity after testing, and predictable privacy boundaries throughout.

## Product Design Direction

qa-scribe should feel Apple-inspired without trying to clone macOS system apps. The interface should be calm, precise, and local-native: excellent typography, restrained neutral surfaces, subtle depth, compact controls, and smooth transitions that support focus rather than decoration.

The app should stay minimal by default. Controls and options should appear when they are relevant to the current Session, Entry, Finding, Draft, or generation step, instead of competing for attention throughout the whole workflow.

The main workspace should be spacious and writing-focused by default, with dense testing details available on demand. The Session Timeline and current Entry composer should receive the most visual priority during capture, while metadata, filters, evidence links, and AI context details should live in contextual side panels, inspectors, or expandable regions.

The primary layout should use a restrained sidebar-first model. A small left sidebar holds the Session Library and global actions, the center pane holds the active Session Timeline and capture composer, and a right inspector appears only when the selected Entry, Finding, Draft, or generation step needs additional controls.

The theme system should support adaptive light and dark appearances from the start, following the user's OS preference by default. Styling should use semantic design tokens for core roles such as background, surface, elevated surface, text, secondary text, border, accent, danger, warning, success, evidence, and selection, so the app has one coherent visual system across both appearances.

Color should stay restrained. qa-scribe should use one primary accent color for selection and primary actions, with subtle semantic colors only where they communicate status or improve scanning, such as failed checks, passed checks, warnings, bugs, open questions, selected evidence, and destructive actions.

Session Timeline Entries should be presented as editor-like blocks in one continuous timeline, not as heavy decorative cards. Each Entry should expose a small type marker, timestamp, optional title, body preview, and contextual actions on hover or focus; screenshots and larger attachments may use richer previews where the evidence benefits from visual inspection.

Controls should use progressive disclosure with a few stable anchors. Create or open Session, add Entry, Generate Testware, search or filter, and settings or provider status should remain easy to find; secondary controls such as Entry edit/delete, evidence linking, API metadata, log formatting, and AI context exclusions should appear only when the relevant object or mode is active.

Motion should be functional and almost invisible. Use short transitions for state changes such as opening the inspector, expanding an Entry, adding a new Entry, switching modes, showing generation progress, and revealing contextual controls; avoid decorative motion that delays capture. The UI should respect the operating system's reduced-motion preference from the start.

Typography should use system font stacks for the MVP. Interface text should use the platform UI font so qa-scribe feels native on macOS, Windows, and Linux; logs, API responses, and code-like content should use the system monospace stack.

Primary workflow actions should use icon-and-text controls, while repeated compact actions can use icon-only buttons with clear hover and focus labels. New Session, Add Entry, and Generate Testware should remain text-labeled; edit, delete, copy, attach, collapse, expand, filter, and more-options actions can be compact icon controls when the context is clear.

On launch, qa-scribe should resume the last active Session while keeping the Session Library visible in the sidebar. If no Session exists, the center pane should show a minimal empty state with a primary New Session action.

The MVP should not introduce a separate design-system workspace or Storybook. Instead, the app should start with shared design foundations inside the renderer: semantic CSS variables, base layout primitives, buttons, icon buttons, text fields, segmented controls, sidebars, inspector panels, timeline Entry blocks, empty states, and motion utilities.

## MVP Scope

The MVP should include:

- Minimal Session Library: create, reopen, rename, and delete Sessions.
- Session metadata: title, Test Target, optional Charter, environment, build or version, related reference.
- Session Timeline: chronological capture of typed Entries.
- Entry types: Note, Observation, API Response, Log, screenshot attachment, and finding candidate.
- SQLite persistence in the Electron main process.
- Managed attachment files referenced from SQLite.
- Explicit AI generation only.
- Generation Context review before provider calls.
- One editable Session Report Draft generated from a Session.
- Jira Bug Draft sections inside the generated Session Report Draft.
- Environment-variable AI provider configuration.
- Local capture remains fully usable without AI configuration.
- Apple-inspired visual direction with adaptive light/dark theming.
- Minimal sidebar-first workspace with contextual inspector.
- Shared renderer design tokens and core UI primitives.

Out of scope for MVP:

- Jira API integration.
- Cross-session analytics.
- Team collaboration or sync.
- Multi-project organization.
- Background AI generation.
- App-managed API key storage.
- Encrypted database by default.
- Full-text search across all Sessions.
- Cloud accounts.

## Main Workflow

1. User opens qa-scribe and the app resumes the last active Session, or shows a minimal New Session empty state if no Session exists.
2. User fills basic Session metadata, including Test Target and optional Charter.
3. During testing, user adds Entries to the Session Timeline.
4. User attaches screenshots or larger files when useful.
5. User optionally marks important Entries as possible Findings.
6. When testing is done, user clicks Generate Testware.
7. qa-scribe shows the Generation Context review: included Session metadata, Entries, attachments, and Findings.
8. User excludes any sensitive or irrelevant material.
9. Electron main process sends the selected Generation Context to the configured AI provider through the AI SDK.
10. qa-scribe stores an immutable AI Run and creates an editable Session Report Draft.
11. User edits the Draft, copies Jira-ready bug content, and saves the Session.

## Suggested Tech Stack

- Desktop shell: Electron.
- Build tooling: electron-vite.
- UI: React and TypeScript.
- UI state: Zustand for local interface state.
- Async data coordination: start with typed IPC calls; add TanStack Query only if needed.
- Styling: plain CSS or CSS modules first.
- Database: SQLite.
- Database access: Drizzle ORM with `better-sqlite3` in Electron main.
- Validation: Zod.
- AI: Vercel AI SDK in Electron main.
- Testing: Vitest, Testing Library, and focused main-process tests.
- Packaging: electron-builder or Electron Forge, to be chosen during the packaging spike.

Security posture:

- `nodeIntegration: false`.
- `contextIsolation: true`.
- Narrow preload bridge.
- No direct database, filesystem, or AI provider access from the renderer.
- Provider keys read from environment variables in the main process.

## Data Saved Locally

SQLite is the source of truth for:

- Sessions.
- Session metadata.
- Test Targets.
- Charters.
- Entries.
- Attachment metadata.
- Evidence links.
- Findings.
- Generation Context selections.
- AI Runs.
- Drafts.

Managed files are stored outside SQLite for larger binary attachments:

- screenshots.
- imported files.
- larger logs or API response bodies when they exceed a practical inline threshold.

Suggested initial tables:

- `sessions`
- `test_targets`
- `entries`
- `attachments`
- `findings`
- `evidence_links`
- `generation_contexts`
- `generation_context_entries`
- `ai_runs`
- `drafts`

Suggested `entries` shape:

- `id`
- `session_id`
- `type`
- `title`
- `body`
- `metadata_json`
- `created_at`
- `updated_at`
- `excluded_from_generation`

Suggested `attachments` shape:

- `id`
- `session_id`
- `entry_id`
- `filename`
- `mime_type`
- `size_bytes`
- `sha256`
- `relative_path`
- `created_at`

## AI Generation Strategy

AI generation should be explicit, reviewable, and stored as Drafts.

MVP generation flow:

- Build a Generation Context from the current Session.
- Let the user review and exclude Entries before sending.
- Use Zod schemas for structured AI output.
- Ask for one Session Report Draft first.
- Store the AI Run separately from the editable Draft.
- Keep prompt versioning in the AI Run so outputs can be traced later.

Initial output schema should include:

- `whatWasTested`
- `scenariosCovered`
- `checks`
- `findings`
- `bugs`
- `openQuestions`
- `followUpActions`
- `jiraBugDrafts`

Privacy rules:

- No background provider calls.
- No API keys stored in SQLite.
- No raw screenshot binaries sent by default.
- Show what will be sent before generation.
- Capture and editing must work without AI.

## Phases

### Phase 0: Foundation

Goal: create a working desktop shell and persistence skeleton.

Deliverables:

- Electron app scaffold.
- React renderer with basic app layout.
- Renderer design tokens for adaptive light/dark theming.
- Core UI primitives for buttons, icon buttons, inputs, panels, empty states, and timeline blocks.
- Secure preload bridge.
- SQLite database initialized in app data.
- Drizzle schema and migration setup.
- Main-process IPC contract for Sessions and Entries.
- Basic test setup.

### Phase 1: Capture MVP

Goal: make qa-scribe useful as a local testing notepad without AI.

Deliverables:

- Session Library.
- Create/open Session flow.
- Session metadata editor.
- Session Timeline.
- Add Note, Observation, API Response, and Log Entries.
- Screenshot/file attachment ingestion.
- Local persistence and reload.
- Basic export to Markdown or JSON for sanity checking.

### Phase 2: Structured Review

Goal: let users shape raw capture into useful testing conclusions manually.

Deliverables:

- Finding creation from Entries.
- Evidence links from Findings to Entries and attachments.
- Basic filters by Entry type.
- Manual Draft editor.
- Copy-friendly Jira Bug Draft format.

### Phase 3: AI Generation

Goal: generate structured Testware from a Session.

Deliverables:

- AI provider status from environment variables.
- Generate Testware command.
- Generation Context review screen.
- AI SDK integration in Electron main.
- Structured Session Report Draft generation.
- AI Run persistence.
- Error handling for missing keys, provider errors, and invalid structured output.

### Phase 4: Privacy And Packaging Hardening

Goal: make the app credible as an installable local-first desktop tool.

Deliverables:

- Packaged builds for macOS, Windows, and Linux.
- App data location review.
- Attachment cleanup and orphan detection.
- Redaction helpers for sensitive Entries.
- Optional database encryption spike.
- Crash-safe save and backup strategy.
- Installer/signing decision.

### Phase 5: Workflow Polish

Goal: improve repeated real-world testing workflows.

Deliverables:

- Templates for common Session types.
- Better Entry filtering and search.
- Regenerate selected Draft sections.
- Copy actions for Jira-ready sections.
- Import/export Session archive.
- Optional OS keychain or secure secret storage.

## First Implementation Steps

1. Scaffold Electron + React + TypeScript with electron-vite.
2. Add renderer design foundations: semantic CSS tokens, adaptive light/dark appearance, base layout primitives, and core controls.
3. Add secure Electron defaults: isolated renderer, preload bridge, no Node integration.
4. Add Drizzle, `better-sqlite3`, and first migrations.
5. Implement app data path resolution and database initialization.
6. Define typed IPC contracts for Sessions and Entries.
7. Build the restrained sidebar-first workspace shell.
8. Build the Session Library screen.
9. Build the Session Timeline screen.
10. Implement Entry creation for Note and Observation first.
11. Add API Response and Log Entry forms.
12. Add managed attachment storage.
13. Add Generation Context review UI without provider calls.
14. Add AI SDK generation behind environment-variable provider config.

## First User Stories And Tickets

### Epic: Desktop Foundation

- As a tester, I can launch qa-scribe as a desktop app.
- As a developer, I can run the app locally in development mode.
- As a developer, I can run tests and type checks from one command.
- As a developer, I can package the app for the current OS.

### Epic: Visual Foundation

- As a tester, I can use qa-scribe in light or dark mode based on my OS preference.
- As a tester, I can recognize primary actions because they use clear icon-and-text labels.
- As a tester, I can work in a calm sidebar-first workspace with the active Session centered.
- As a tester, I see secondary controls only when they are relevant to what I am doing.
- As a tester, I experience subtle transitions that do not slow down capture.
- As a tester, I can use the app with reduced motion enabled.

### Epic: Session Library

- As a tester, I can create a new Session.
- As a tester, I can reopen a recent Session.
- As a tester, I can rename a Session.
- As a tester, I can delete a Session.
- As a tester, I can see when each Session was last updated.

### Epic: Session Metadata

- As a tester, I can describe the Test Target.
- As a tester, I can record the environment under test.
- As a tester, I can record a build, version, URL, or related ticket.
- As a tester, I can add an optional Charter.

### Epic: Timeline Capture

- As a tester, I can add a Note to the Session Timeline.
- As a tester, I can add an Observation to the Session Timeline.
- As a tester, I can paste a Log Entry.
- As a tester, I can paste an API Response with status and URL metadata.
- As a tester, I can attach a screenshot or file to an Entry.
- As a tester, I can edit or delete an Entry.

### Epic: Findings And Evidence

- As a tester, I can create a Finding from one or more Entries.
- As a tester, I can link Evidence to a Finding.
- As a tester, I can distinguish bugs, failed checks, passed checks, open questions, and follow-up actions.

### Epic: AI Generation

- As a tester, I can see whether an AI provider is configured.
- As a tester, I can start Generate Testware explicitly.
- As a tester, I can review the Generation Context before sending.
- As a tester, I can exclude sensitive Entries from generation.
- As a tester, I can generate a Session Report Draft.
- As a tester, I can edit generated Draft text.
- As a tester, I can copy a Jira-ready bug draft.

### Epic: Privacy And Reliability

- As a tester, I can use qa-scribe without configuring AI.
- As a tester, I can see when data will leave my machine.
- As a tester, I can keep API keys out of the app database.
- As a tester, I can trust that captured Entries persist after restarting the app.
- As a tester, I can export my Session data for backup or review.

## Open Questions

- Which AI provider should be the first supported provider through environment variables?
- Should the initial app use electron-builder or Electron Forge?
- What threshold decides whether text-like content is stored inline or as an attachment file?
- Should screenshots be captured from clipboard only first, or should the app include a screen capture command?
- What is the first target platform for packaging?
- Should optional encryption use SQLCipher, encrypted libSQL/Turso, or OS-level disk encryption guidance first?
