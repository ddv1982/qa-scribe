# Codebase Improvement Plan

This document captures a full-codebase review of qa-scribe as of 2026-06-18. It began as a planning artifact and now also tracks implementation status for the evidence-backed improvements.

## Implementation Status

Implemented so far:

- Attachment lifecycle and limits: managed-file cleanup, failed-import compensation, import/preview limits, and image byte validation.
- Provider detection and generation flow: disabled-provider checks avoid CLI probes and generation reuses one provider-status snapshot.
- Renderer accessibility and inert controls: Generation Context attachment import is wired, inert controls were removed, timeline selection uses a dedicated button, and enabled Note titles are visible.
- RPC, persistence, and AI hardening: conservative body/metadata limits, Generation Context transactionality, Session-scoped indexes, untrusted prompt delimiters, and tolerant structured CLI JSON parsing.
- Documentation and release contract cleanup: historical planning docs are marked, migration responsibilities are clarified, and build scripts run verification before packaging.
- Bounded architecture cleanup: the Evidence import modal was extracted from `App.tsx` into a focused component; broader renderer orchestration cleanup remains incremental follow-up work.

## Review Scope

Deployment context: local-first desktop app built with Electrobun, Bun, React, TypeScript, SQLite, and Drizzle. The main process owns SQLite, managed attachment files, provider CLI execution, and RPC handlers. The renderer owns Session Library UI, Session Timeline capture, Generation Context review, Draft editing, and user-triggered AI generation.

Reviewed areas:

| Area | Coverage |
| --- | --- |
| Main services and persistence | `src/main/**/*.ts`, including session service, AI provider adapters, DB schema, migrations, and tests |
| Renderer UI and state | `src/renderer/src/**/*.{ts,tsx,css}`, including App state, components, domain helpers, styles, and tests |
| Host/shared bridge | `src/bun/**/*.ts`, `src/shared/**/*.ts`, and `src/renderer-view/**/*.ts` |
| Docs/build contracts | `README.md`, `CONTEXT.md`, `docs/**/*.md`, `package.json`, `tsconfig*.json`, `electrobun.config.ts`, `drizzle.config.ts`, and `scripts/*.cjs` |

## Priority Plan

| Priority | Workstream | Outcome | Suggested validation |
| --- | --- | --- | --- |
| P1 | Attachment lifecycle and limits | Managed attachment files are cleaned up consistently, imports have compensation on failure, previews are bounded, and image metadata is not trusted by extension alone. | Focused `SessionService` tests for failed imports, Session deletion cleanup, image signature handling, and preview limits; `bun run lint`; `bun run test`. |
| P1 | Provider detection and generation flow | Disabled providers are not probed, generation uses one provider-status snapshot, and provider availability checks remain explicit. | Provider facade tests for disabled providers and single detection pass; generation tests with unavailable provider cases; `bun run lint`. |
| P1 | Renderer accessibility and inert controls | Visible buttons either perform actions or are removed/disabled, timeline selection no longer nests interactive controls inside a `role="button"` container, and key dialogs/controls have keyboard behavior. | React Testing Library keyboard/focus tests for Session Timeline, Generation Context actions, Draft finding open action, severity picker, and attachment dialog. |
| P2 | RPC and contract hardening | Request and response validation are easier to audit, large user-controlled text fields have product-appropriate limits, and endpoint duplication is reduced without hiding the explicit bridge boundary. | Contract tests for oversized Entry/Finding/Draft inputs, metadata JSON, response schemas, and generated or centralized endpoint typing. |
| P2 | Persistence integrity and performance | Multi-row Generation Context creation is atomic, enum-like fields have DB constraints where practical, and Session-scoped list queries have indexes. | Migration tests against existing data, focused DB tests for rollback behavior, and list-query smoke tests with larger Session data. |
| P2 | AI prompt and output robustness | Raw Entry, Log, API Response, and attachment metadata are clearly delimited as untrusted context, and CLI output parsing tolerates or rejects wrapper text deliberately. | Prompt snapshot or unit tests for delimiter structure; adapter tests with warning-prefixed stdout; provider dry-run checks where available. |
| P3 | Documentation and release contract cleanup | Historical plans are marked as such or updated, migration workflow is clarified, and packaging scripts match release expectations. | Docs review against README and ADRs; script-level smoke checks; `bun run lint`; release checklist review. |
| P3 | Ongoing architecture cleanup | Large orchestrators are split by existing responsibilities without changing product behavior or persisted data. | Focused renderer/service tests around each extraction; `bun run lint`; final `bun run test` before merging broad cleanup. |

## Evidence-Backed Improvement Areas

### 1. Attachment Lifecycle And Input Limits

Class: correctness, persistence, security/privacy

Severity: P1

Evidence: `importAttachment()` reads and copies the file before inserting the attachment row (`src/main/services/sessionService.ts:312`, `src/main/services/sessionService.ts:324`, `src/main/services/sessionService.ts:327`). `importClipboardScreenshot()` writes bytes before inserting the DB row (`src/main/services/sessionService.ts:363`, `src/main/services/sessionService.ts:366`). `deleteSession()` deletes only the Session row (`src/main/services/sessionService.ts:226`). Image preview reads the full file into a base64 data URL (`src/main/services/sessionService.ts:386`). MIME type is derived from extension during import (`src/main/services/sessionService.ts:333`). The file dialog accepts common image/text/log/json types plus `*` (`src/bun/rpc.ts:24`).

Guards checked: Session and Entry ownership are checked before attachment import (`src/main/services/sessionService.ts:307`, `src/main/services/sessionService.ts:741`). DB cascade removes attachment rows when a Session is deleted (`src/main/db/migrations.ts:34`). No corresponding file cleanup or write-compensation path was found in the reviewed service slice.

Why it matters: qa-scribe stores Evidence files outside SQLite. A DB insert failure after a file write can orphan managed files, and Session deletion can leave stale files in the app data directory. Large or mislabeled files can also be loaded wholly into memory for preview.

Fix shape: add attachment import compensation, Session deletion cleanup for managed files, size limits or warnings for imports/previews, and content-based image validation for image-only preview/copy paths.

### 2. Provider Detection Does More Work Than The User Requested

Class: correctness, privacy, performance

Severity: P1

Evidence: `getProviderStatus()` loads settings, but then calls `detectProviderStatuses()` for all providers before marking disabled providers unavailable (`src/main/services/sessionService.ts:701`). `detectProviderStatuses()` probes Claude, Codex, and Copilot in parallel (`src/main/services/aiProviders.ts:28`). `generateTestware()` calls `resolveGenerationOptions()` and then calls `getProviderStatus()` again (`src/main/services/sessionService.ts:648`, `src/main/services/sessionService.ts:649`), while `resolveGenerationOptions()` also calls `getProviderStatus()` (`src/main/services/sessionService.ts:756`).

Guards checked: Settings do mark disabled providers unavailable after detection (`src/main/services/sessionService.ts:703`). Generation records a failed AI Run if the selected provider is unavailable (`src/main/services/sessionService.ts:650`). These guards do not avoid probing disabled providers or the duplicate detection pass.

Why it matters: provider checks execute local CLI commands. Disabled providers should not create avoidable latency, command execution, or user surprise in a privacy-sensitive local-first app.

Fix shape: thread enabled-provider settings into detection and reuse one provider-status snapshot through generation option resolution and availability validation.

### 3. Renderer Orchestration Is Concentrated In `App.tsx`

Class: bloat, maintainability

Severity: P1

Evidence: `App()` declares state for Session Library data, Session setup, capture, filters, providers, settings, selection, autosave, Generation Context, Findings, Drafts, attachments, busy flags, import targets, notices, and version refs in one component (`src/renderer/src/App.tsx:79`). The existing architecture cleanup plan already identifies `App.tsx` as a large renderer container with mixed responsibilities (`docs/architecture-cleanup-plan.md:16`).

Guards checked: Existing tests cover several user flows across capture, autosave, generation, Drafts, and Session setup, so the issue is not absence of all coverage. The risk is that one conceptual change requires editing a central component that owns unrelated workflows.

Why it matters: Session capture, Generation Context review, Draft editing, settings, and attachment import are independent product areas. Keeping all orchestration in one component increases regression risk and makes targeted changes harder to review.

Fix shape: split by behavior boundaries rather than line count. Good first seams are Session workspace state, capture composer state, Generation Context state, Draft autosave, attachment import, and settings draft persistence.

### 4. Several Visible Controls Are Inert Or Semantically Risky

Class: correctness, UI/accessibility

Severity: P1

Evidence: Generation Context renders `+ Add attachment` with no click handler (`src/renderer/src/components/generation/GenerationReviewPane.tsx:174`). Review lists render `+ Add more` / `+ Add exclusions` action buttons with no click handler (`src/renderer/src/components/generation/GenerationReviewPane.tsx:274`). Draft Finding preview rows render `Open` buttons with no click handler (`src/renderer/src/components/drafts/DraftsPane.tsx:241`, `src/renderer/src/components/drafts/DraftsPane.tsx:254`). Timeline entries render an `article` with `role="button"`, click and keyboard selection handlers, and nested action buttons for Finding creation, Evidence attachment, include/exclude, and delete (`src/renderer/src/components/capture/CapturePane.tsx:607`, `src/renderer/src/components/capture/CapturePane.tsx:623`). The Note title field is rendered but visually clipped to 1px (`src/renderer/src/components/capture/CapturePane.tsx:249`, `src/renderer/src/styles/capture.css:314`).

Guards checked: Nested buttons stop click propagation through `stopAnd()` (`src/renderer/src/components/capture/CapturePane.tsx:624`), but that does not make the parent/child interactive semantics valid. Existing tests exercise some click and keyboard paths but do not cover these inert buttons or broader screen-reader/focus behavior.

Why it matters: Testers can see controls that do nothing, and assistive technology users may encounter invalid nested interactive semantics. The hidden Note title also makes template-driven fields harder to discover.

Fix shape: wire the controls to real flows, or render them as disabled/planned affordances. Refactor timeline row selection away from a `role="button"` container with nested controls, make Note title visibility match settings, and add keyboard/focus tests.

### 5. RPC Contracts Are Explicit But Repeated And Mostly Request-Validated

Class: contract, maintainability

Severity: P2

Evidence: The endpoint list appears in the shared RPC schema (`src/shared/rpc.ts:35`), the public `QaScribeApi` interface (`src/shared/contracts.ts:443`), the renderer adapter mapping (`src/renderer-view/qaScribeApi.ts:28`), and host handlers (`src/bun/rpc.ts:30`). Host handlers parse request inputs with Zod before calling the service (`src/bun/rpc.ts:35`), while responses are returned directly from the service. Entry body and metadata input are minimally constrained (`src/shared/contracts.ts:79`). Draft create and patch bodies are accepted without size limits (`src/shared/contracts.ts:370`, `src/shared/contracts.ts:378`).

Guards checked: The explicit bridge is a deliberate architectural boundary, and request validation is present at the RPC boundary. The finding is not that the bridge is unsafe by default; it is that contract changes require scattered edits and response validation is not evident in the bridge layer.

Why it matters: A local-first app still needs stable public method names and predictable persisted shapes. Repeated endpoint definitions increase drift risk, and unbounded text/metadata fields can stress persistence, export, and generation.

Fix shape: introduce a small endpoint registry or helper that binds request and response schemas while preserving explicit handler ownership. Add product-appropriate max sizes and JSON validation for metadata fields.

### 6. Persistence Integrity Can Be Hardened

Class: correctness, persistence, performance

Severity: P2

Evidence: `createGenerationContext()` inserts the context row, then loops through Entries and attachments with separate inserts (`src/main/services/session/generationContext.ts:24`, `src/main/services/session/generationContext.ts:38`, `src/main/services/session/generationContext.ts:50`). By contrast, Finding creation uses an explicit transaction when multiple writes must remain consistent (`src/main/services/sessionService.ts:406`). The first migration constrains `entries.type`, but `findings.kind`, `ai_runs.provider`, `ai_runs.status`, and `drafts.kind` are plain text fields (`src/main/db/migrations.ts:25`, `src/main/db/migrations.ts:51`, `src/main/db/migrations.ts:81`, `src/main/db/migrations.ts:84`, `src/main/db/migrations.ts:94`). Session-scoped lists query by Session and ordering fields, but no indexes were found in the reviewed migrations.

Guards checked: Foreign keys and cascades exist for core relationships. The gap is transactionality and defensive constraints for multi-row writes and enum-like values.

Why it matters: A failed insert can leave a partial Generation Context, and large Sessions will put more pressure on repeated Session-scoped list queries.

Fix shape: wrap Generation Context creation in a transaction, add safe future migrations for CHECK constraints where SQLite compatibility allows, and add indexes for the high-frequency Session Timeline, attachment, Finding, Draft, and AI Run list paths.

### 7. AI Prompt And CLI Output Boundaries Need Deliberate Hardening

Class: security/privacy, correctness

Severity: P2

Evidence: The generation prompt instructs the model to use only supplied context (`src/main/services/session/generation.ts:224`), then appends raw Entry titles and bodies directly into the prompt (`src/main/services/session/generation.ts:249`). Attachment metadata is appended directly as well (`src/main/services/session/generation.ts:255`). Structured CLI output parsing expects the entire trimmed stdout to parse as JSON before extracting result fields, so warning or wrapper text on stdout causes failure (`src/main/services/ai/structuredOutput.ts:4`).

Guards checked: The app keeps AI generation explicit and sends attachment metadata only, matching README privacy boundaries. Structured output is parsed with schemas after the provider returns. The remaining issue is untrusted Session Timeline text being visually close to system instructions, and provider stdout assumptions being brittle.

Why it matters: Entries can include copied logs, API responses, or arbitrary product text. Those should be isolated as untrusted Evidence/context. Real CLIs can also emit warnings or banners that break strict JSON parsing.

Fix shape: add clear delimiters and labels around untrusted Session data, preserve the protected instruction block, and decide whether CLI adapters should extract a JSON object from stdout or fail with a clearer provider-specific error.

### 8. Docs And Release Contracts Drift From The Current Architecture

Class: contract, documentation, release readiness

Severity: P3

Evidence: README describes the current implementation as Electrobun/Bun/React/SQLite/Drizzle (`README.md:9`) and package scripts use Electrobun (`package.json:9`). The initial phased plan still says SQLite persistence is in Electron main, build tooling is electron-vite, and DB access is Drizzle with `better-sqlite3` (`docs/initial-phased-plan.md:47`, `docs/initial-phased-plan.md:87`, `docs/initial-phased-plan.md:94`). README says pre-sharing verification should run lint, test, and build (`README.md:166`), but `build` only runs lint plus Electrobun build, and channel builds skip lint and tests (`package.json:11`, `package.json:12`, `package.json:14`). Electrobun config has mac codesign and notarization disabled and empty release `baseUrl` (`electrobun.config.ts:32`, `electrobun.config.ts:40`). The platform guard script is not invoked by package scripts (`scripts/assert-package-platform.cjs:1`, `package.json:8`).

Guards checked: Some older docs may be intended as historical records. The problem is that they are not consistently marked as historical or superseded, so readers can mistake them for current plans.

Why it matters: The repo already has a clear current architecture, but stale docs and weak release scripts make it harder to know which contracts are authoritative before packaging or refactoring.

Fix shape: mark historical planning docs as superseded or update them, clarify the Drizzle generation versus runtime `user_version` migration workflow, add release readiness notes, and decide whether package scripts or CI should enforce lint/test/platform gates.

## Positive Findings To Preserve

| Area | Evidence |
| --- | --- |
| Explicit local-first privacy boundary | README states AI calls are explicit, provider choices are per-run, and attachment binaries are not sent by default (`README.md:90`, `README.md:91`, `README.md:93`). |
| Zod request validation at bridge boundary | RPC handlers parse request inputs before calling services (`src/bun/rpc.ts:35`). |
| Existing architecture cleanup constraints | `docs/architecture-cleanup-plan.md` preserves public API names, persisted fields, provider privacy, explicit RPC validation, and no generic repository layer. |
| Behavior-focused tests already exist | Renderer and main service tests cover capture, autosave, generation, Drafts, provider behavior, and SessionService flows. |

## Follow-Up Order

1. Fix attachment lifecycle and provider probing first because they touch local data, filesystem state, provider command execution, and privacy expectations.
2. Address inert controls and accessibility semantics before deeper renderer extraction so behavior and tests are clear before moving state.
3. Harden RPC contracts, input limits, and persistence transactions before larger storage or generation features add more data volume.
4. Update docs and release contracts before packaging or sharing release artifacts beyond local development.
5. Continue architecture cleanup incrementally, using the existing cleanup plan as the guardrail and validating each extraction with focused tests plus `bun run lint`.
