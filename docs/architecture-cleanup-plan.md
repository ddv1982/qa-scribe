# Architecture Cleanup Plan

This plan records the behavior-preserving cleanup baseline for qa-scribe. It is a guardrail for simplifying large files without changing product behavior, persisted data, public RPC contracts, or the local-first privacy model.

## Current Boundaries

- Electrobun host owns SQLite, managed attachment files, provider CLI execution, and Zod-validated RPC handlers.
- The renderer-view adapter exposes the narrow typed `window.qaScribe` bridge and does not expose raw Electrobun primitives.
- The renderer owns React UI state, Session Library views, Session Timeline capture, Generation Context review, Draft editing, and user-triggered generation controls.
- Shared contracts define cross-boundary schemas and TypeScript types used by the host, renderer-view adapter, and renderer.
- SQLite remains the source of truth for Session, Entry, Evidence link, Finding, Draft, AI Run, and Generation Context metadata.
- Managed attachment files stay outside SQLite, with ownership and metadata stored in the database.

## Cleanup Targets

- `src/renderer/src/App.tsx`: large renderer container with Session Library state, selected Session snapshot state, capture composer state, provider/generation state, Draft state, autosave, busy state, and toast handling.
- `src/renderer/src/components/AppSections.tsx`: large component collection that mixes capture, generation, Draft, inspector, and Evidence display sections.
- `src/main/services/sessionService.ts`: main-process service covering Sessions, Entries, attachments, Findings, Evidence links, Drafts, AI Runs, Generation Contexts, generation, and export orchestration.
- `src/main/services/aiProviders.ts`: provider facade that also contains provider status detection, CLI execution, model metadata discovery, structured output parsing, and provider-specific command details.
- `src/main/db/client.ts`: SQLite client plus runtime migration logic based on `user_version`.
- Large tests should only be split when the implementation split creates clearer behavior ownership.

## Standards For Changes

- Keep changes behavior-preserving unless a separate product change is approved.
- Split by existing responsibilities, not by arbitrary line counts.
- Prefer named ES module exports and direct imports over registries, namespaces, or automatic handler discovery.
- Keep React state minimal, avoid duplicate or contradictory state, and derive values during render when practical.
- Keep provider CLI safety and privacy flags visible near the provider implementation that owns them.
- Keep Drizzle queries close to the service logic they support unless a repeated, domain-specific helper clearly reduces coupling.
- Keep tests focused on user-visible behavior and service outcomes, not implementation trivia introduced by file moves.

## Non-Goals

- Do not add Redux, Zustand, TanStack Query, or a new renderer state architecture for this cleanup.
- Do not introduce a generic repository layer over Drizzle.
- Do not auto-register RPC handlers or generate RPC channel maps.
- Do not move database, filesystem, or provider CLI access into the renderer.
- Do not expose raw Electrobun APIs, filesystem paths, or provider commands through the renderer-view adapter.
- Do not rename public `QaScribeApi` methods, persisted fields, command names, provider names, or database tables as part of cleanup.
- Do not replace explicit AI generation with background generation or provider probing that sends Session data without user action.

## Validation Expectations

- Documentation-only cleanup can be validated with `bun run lint` plus manual review against project language and non-goals.
- Renderer refactors should run focused renderer tests and `bun run lint`.
- Main-process service refactors should run focused service tests and `bun run lint`.
- Provider refactors should run provider tests and `bun run lint`.
- The final cleanup gate should run `bun run lint`, `bun run test`, and `bun run build`.

## Review Checklist

- Every changed artifact maps to a listed cleanup target or validation need.
- Session, Entry, Evidence, Finding, Testware, Session Library, optional Session context, Session Timeline, Generation Context, Draft, and AI Run language is preserved in user-facing docs and UI.
- The trusted Electrobun view exposes only the explicit `window.qaScribe` compatibility API.
- RPC remains explicitly validated with Zod.
- Existing local data remains readable through the current runtime migrations.
- Capture, persistence, manual Draft editing, export, and Session work continue to function without AI configuration.
