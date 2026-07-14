# ADR 0010: Session workspaces and trustworthy CLI discovery

**Status:** Accepted

**Date:** 2026-07-13

## Context

QA Scribe currently presents Sessions, Testware, and Findings as peer global
destinations even though generated output belongs to a Session. Its AI settings
also preserve the correct runtime intent (the CLI resolves `default`) but do not
clearly distinguish that intent from the most recently observed CLI
configuration.

The implementation plan in
`docs/default-cli-config-and-ux-overhaul-plan.md` requires these product choices
to be settled before the shell and provider contract are changed.

## Decision

1. **Session ownership.** Notes, Testware, and Findings are tabs in a Session
   workspace. Cross-session Testware and Finding libraries remain available as
   secondary library views and always show Session provenance.
2. **Saving.** Session notes keep their existing autosave behavior. Settings,
   Testware, and Findings remain explicit-save and must offer Save, Discard, and
   Cancel/navigation protection when dirty.
3. **Custom models.** Free-form model IDs remain supported because provider
   catalogs may omit hidden, staged, or newly released models. The selector must
   implement the editable-combobox interaction model.
4. **Discovery staleness.** A successful CLI snapshot is fresh for five minutes.
   A preflight refreshes absent or stale data. If refresh fails, the last good
   observation remains visible as stale and execution still delegates defaults
   to the CLI.
5. **Warnings.** Discovery and catalog mismatches are advisory. Only provider
   unavailability, invalid explicit overrides, and failures that make execution
   unsafe are blocking.
6. **Path privacy.** Default UI shows home-relative or categorical origins.
   Absolute paths and raw diagnostics appear only in the explicit CLI details
   disclosure and are never included in routine status announcements.
7. **Finding model.** Findings keep the documented `bug`, `question`, `risk`,
   `follow_up`, and `note` kinds. Passed/failed checks belong to Testware results,
   not Finding kinds.
8. **Command ownership.** Every user action will have one canonical command
   definition. Visible buttons, menus, shortcuts, and the command palette invoke
   those definitions rather than duplicating handlers.
9. **Catalog/default separation.** Account model catalogs and effective-default
   observations have independent lifecycle, cache, error, and stale states. A
   successful observation in one cannot make an unrun or failed observation in
   the other appear fresh.
10. **Catalog authority.** Structured, signed-in CLI catalogs outrank CLI help,
    which outranks declarative configuration evidence and curated presets. Every
    entry retains its evidence source, confidence, and availability; lower layers
    are never presented as account entitlement evidence.
11. **Neutral discovery.** Every provider subprocess, including generic version,
    help, authentication, and structured-catalog probes, runs in a short-lived
    neutral directory. Catalog transports have an absolute deadline, bounded
    frames/output/model count, and process-tree cleanup.
12. **Discovery privacy.** Normal DTOs and persisted frontend cache may contain
    model metadata, sanitized categories, CLI version, and relative/categorical
    origin labels. They may not contain credential values, account identity,
    organization payloads, repository content, executable paths, technical
    paths, raw protocol records, or raw provider stderr.

## Discovery contract

The UI must represent three different facts independently:

- saved intent: CLI default or QA Scribe override;
- last observation: effective value, origin, CLI version, and checked time;
- runtime behavior: whether QA Scribe passes an override or delegates live
  resolution to the provider CLI.

Model and reasoning observations have independent resolutions and provenance.
Inspection uses the same neutral working-directory policy as generation.
Detected values are display evidence only and are never converted into explicit
generation arguments.

Claude Code and GitHub Copilot catalog discovery sends no natural-language
prompt and creates no provider conversation. Provider-managed `default` and
`auto` remain submitted intent; an observed `resolvedModel` is explanatory
metadata and never becomes an explicit override. Custom model IDs remain
available even when absent from a fresh catalog.

The Claude and Copilot structured catalogs roll out through
`QA_SCRIBE_PROVIDER_CATALOG_MODE`: `disabled` is the kill switch,
`diagnostics` observes the catalog while retaining compatibility selector
choices, and `selector` makes the catalog the selector source. Codex retains its
existing structured behavior in every mode.

## Benchmark workflows

The acceptance suite and structured walkthroughs use these five workflows at
1440, 760, and 320 CSS pixels:

1. create a Session and run a first generation with CLI defaults;
2. switch between a Session note, its Testware, and its Findings;
3. edit a Finding, discard once, then save;
4. recover from a failed provider refresh using the retained snapshot;
5. locate AI execution settings and return to the original context.

The implementation target is at least 25% less backtracking than the v0.7.14
shell, no unrecoverable input loss, and successful keyboard-only completion.

## Consequences

The provider DTO becomes richer, the app needs explicit discovery lifecycle
state, and the shell routes become Session-centered. The existing visual token
system remains the foundation; this ADR authorizes structural changes rather
than another visual-theme replacement.

Provider protocol changes now require sanitized fixture refreshes and opt-in
live contract tests. Authenticated multi-platform checks and provider policy or
billing confirmations remain release controls rather than deterministic CI
dependencies.
