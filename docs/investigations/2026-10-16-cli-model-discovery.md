# CLI model discovery and selection findings

Investigated on 2026-10-16. This report distinguishes existing behavior, observed local results, and proposed changes.
QA Scribe baseline is `ac96962daf935f2e5ba187a81dc1c8fd52331626`, the v0.8.9 release merge.
The inspected release worktree has identical production source at `2b9385aa2af1ded8dec65f4cb5274995da10e6c2`.
T3 Code baseline is `e58a4857130a93cc58b45dd6ebee14cf08df04ec`.

## Overview

QA Scribe already discovers models, shows a searchable picker, accepts custom IDs, and saves an override for each provider.
Selecting a model changes the next QA Scribe invocation. It does not change the external CLI's global settings.
The useful work is to improve model evidence, close provider compatibility gaps, and expose selection near the next turn.

Claude and Copilot account catalogs remain diagnostic by default. Codex already uses its catalog for model choices.
A successful catalog read does not prove entitlement, successful inference, or the exact backend model that serves a request.

## Key concepts

| Concept | Meaning | Required treatment |
| --- | --- | --- |
| Requested selection | Provider-managed Default, Copilot Auto, or an explicit ID | Preserve the user's intent without replacing it with an observed default |
| Observed CLI default | Configured or recommended value from discovery | Show its source, freshness, and neutral working-directory scope |
| Advertised choice | A model reported by a CLI catalog or compatibility fallback | Preserve source and confidence. Do not promise account access |
| Reported model | Model metadata from a particular invocation | Associate it with that invocation and retain missing evidence as unknown |
| Actual serving backend | Provider-internal route or fallback | Claim only what the provider exposes. A selected ID does not prove it |

Use the existing provider descriptors and discovery states. Add a small typed representation for requested selection and runtime evidence only where current storage loses that distinction.
Do not build another provider registry or copy T3 Code's server architecture.

## How the app works

Settings writes `selected_ai_models_by_provider`. The legacy scalar remains a compatibility mirror.
The controller saves through the existing SQLite settings service.
The CLI command builder omits the model argument for provider-managed Default and Copilot Auto.
An explicit ID becomes `--model` for the next invocation.
Copilot Auto currently omits the argument too. This differs from its automatic-selection label when external configuration names an explicit model.
Installed CLI help explicitly supports `--model auto`. The plan must prove and correct this distinction for generation and Chat.

Every Chat turn launches a fresh provider invocation with a prompt reconstructed from saved history.
Codex creates a new ephemeral thread. Copilot creates a new ACP session. Claude disables session persistence.
There is no existing resumed provider session that needs an in-place model switch.
A new quick picker can reuse the Settings preference owner and apply to the next invocation.
It must not change an active turn or transfer its permission requests.

AI run persistence currently has one `model` string.
The field begins with requested intent and may later receive runtime metadata.
That loses the distinction between requested and reported model.
The Chat header also follows the current global selection rather than the prior turn's report.
Historical records cannot be retrospectively certified as provider-reported evidence.

## Where things live

Paths below refer to the pinned QA Scribe revision. The checkout at `/tmp/qa-scribe-release-v0.8.9` contains the inspected source.

| Responsibility | File and entry point |
| --- | --- |
| Per-provider settings | `crates/qa-scribe-core/src/domain/settings.rs`, `AppSettings` |
| Selection UI | `frontend/src/components/ModelSelector.tsx`, `frontend/src/views/SettingsView.tsx` |
| Intent versus display | `frontend/src/settings/defaults.ts`, `effectiveSelection` |
| Discovery types | `src-tauri/src/commands/providers/types.rs` |
| Model catalogs | `src-tauri/src/commands/providers/models/catalog.rs` |
| Default observations | `src-tauri/src/commands/providers/defaults.rs` |
| Catalog rollout | `src-tauri/src/commands/providers/rollout.rs` |
| Fingerprints and stale reuse | `src-tauri/src/commands/providers/cache.rs`, `probe/identity.rs` |
| Frontend startup cache | `frontend/src/settings/providerStatusCache.ts` |
| Invocation arguments | `crates/qa-scribe-core/src/ai/mod.rs` |
| Runtime model storage | `crates/qa-scribe-core/src/domain/ai_run.rs`, `generation/workflow.rs`, `services/session_service/chat_turns.rs` |
| Protocol metadata | `crates/qa-scribe-core/src/ai/chat_protocol/{claude,codex,copilot}.rs` |
| Chat launch | `src-tauri/src/commands/chat/lifecycle.rs` |

## Provider capabilities and limits

### Codex

The app-server exposes paginated `model/list`, including effort options and default metadata.
Model choices and defaults depend on the installed client and account.
QA Scribe already reads that catalog and `config/read`, then falls back to CLI debug output and presets.
Chat can read a model from the `thread/start` response. That establishes thread configuration, not an independently observed serving backend.
The common generation metadata reader does not currently establish a Codex-specific reported model.
Use supported structured metadata when present and keep the report unknown otherwise.

Official source is [Codex App Server](https://learn.chatgpt.com/docs/app-server#models).
Local no-prompt observation used Codex `0.163.0`. Initialization and `model/list` succeeded with seven visible entries in one page.
The probe sent no thread creation or turn request.
Its summary is `/tmp/qa-scribe-model-investigation-20261016/codex-catalog-summary.json`.
This probe exercised the protocol directly. It did not exercise QA Scribe's frontend or prove a selected model can generate.

### Claude Code

The existing initialization-only adapter returned 13 catalog entries with installed Claude Code `2.1.301`.
That passed the existing ignored live catalog contract.
The observation proves that this installed CLI responds to this adapter on Linux.
It does not complete the existing platform, account, billing, or publication gates.

Claude supports a launch model override, environment configuration, settings, and interactive model switching.
Managed allowlists and organization restrictions can limit choices or replace a requested model.
The app must preserve the requested alias alongside provider-reported metadata and accept Default remaining unresolved before a turn.
See [Claude model configuration](https://code.claude.com/docs/en/model-config).

The existing repository contract already requires external evidence before promoting subscription-backed discovery.
A successful local test does not replace that requirement.
The [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk) also states an approval condition for third-party use of claude.ai login and rate limits.
This investigation establishes no authorization position for QA Scribe.

### GitHub Copilot

Installed Copilot `1.0.69` failed QA Scribe's live catalog contract with sanitized category `Unavailable`.
A separate initialization-only diagnosis established that protocol-3 connection and status requests succeed.
The authentication status reports authenticated, but `models.list` returns JSON-RPC `-32603` with a string-only unauthorized rejection containing a 403 marker.
The exact account entitlement or service-side reason remains unknown.
The app's classifier inspects numeric HTTP status fields and loses this distinction.
Do not claim that Copilot model discovery is generally broken or that the protocol version is incompatible.

The CLI supports `--model` and explicit automatic selection with `--model auto`.
QA Scribe currently collapses Auto into the same omitted argument as Default in `crates/qa-scribe-core/src/ai/mod.rs`, `selected_copilot_model_arg`.
The Chat builder shares that helper. This is source-confirmed argument behavior, not an authenticated automatic-routing test. Catalog availability can differ from help text and saved config.
Use structured response metadata when available. Do not parse assistant prose as model identity.
See [Copilot programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference).
This review did not send a generation prompt or change the saved CLI model.

## What T3 Code contributes

T3 Code provides useful patterns for typed provider catalogs, per-model options, and retaining a selection across catalog refreshes.
Its Codex integration uses the CLI app-server catalog with pagination.
It can apply its own preferred default, so copying its `isDefault` policy would change QA Scribe's provider-managed behavior.

Its Claude choices use a bundled and remotely refreshed version-gated manifest.
That is a curated inventory with a different authority from account discovery.
A remote manifest would add a distribution and trust dependency to QA Scribe.
Keep it as a possible future fallback only if existing compatibility lists prove insufficient.

Its generic ACP support obtains model choices from session configuration options and the current value.
It recognizes Copilot through that ACP driver.
This is a candidate source for per-session choice metadata if Copilot's existing account catalog cannot provide it.
Session setup can create provider state. Evaluate that cost before using ACP for background discovery.

Adopt the separation between provider inventory and selected invocation options.
Reuse QA Scribe's current Rust adapters, typed DTOs, cache identity, and ModelSelector.
Do not add T3's Effect services, generic ACP registry, or a JavaScript sidecar for this feature.

Pinned T3 reading list follows.

- [Version-filtered Claude catalog](https://github.com/pingdotgg/t3code/blob/e58a4857130a93cc58b45dd6ebee14cf08df04ec/apps/server/src/provider/ClaudeModelCatalog.ts#L160-L186).
- [Claude provider catalog integration](https://github.com/pingdotgg/t3code/blob/e58a4857130a93cc58b45dd6ebee14cf08df04ec/apps/server/src/provider/ClaudeProvider.ts#L465-L605).
- [Typed model selection](https://github.com/pingdotgg/t3code/blob/e58a4857130a93cc58b45dd6ebee14cf08df04ec/packages/contracts/src/modelSelection.ts#L9-L51).
- [Codex provider](https://github.com/pingdotgg/t3code/blob/e58a4857130a93cc58b45dd6ebee14cf08df04ec/apps/server/src/provider/CodexProvider.ts).
- [ACP catalog normalization](https://github.com/pingdotgg/t3code/blob/e58a4857130a93cc58b45dd6ebee14cf08df04ec/packages/provider-acp-registry/src/server/probe.ts).
- [ACP adapter and Copilot recognition](https://github.com/pingdotgg/t3code/blob/e58a4857130a93cc58b45dd6ebee14cf08df04ec/packages/provider-acp-registry/src/server/adapter.ts).

## Gotchas

- Neutral discovery does not include every project-specific setting applied during an invocation.
- Catalog aliases, recommended defaults, selected overrides, and reported models answer different questions.
- Unknown runtime evidence must stay unknown. A historical model string has ambiguous provenance.
- Settings changes affect later invocations. An in-flight turn keeps its captured selection.
- Custom IDs remain useful when a CLI supports a model that its catalog omits. Validate shape and retain provider rejection.
- Account catalogs must not survive identity changes or leak through the persisted frontend startup cache.
- Selecting a model does not grant access to a provider, plan, policy, or unsupported model.
- Existing reasoning metadata is not consistently an editable setting. Add effort controls only when the exact invocation path supports them.

## Verification receipt

The parent read the actual QA Scribe and T3 source and official provider documentation.
Two read-only explorers covered app ownership and upstream architecture. A third diagnosed the failing Copilot probe.
The explorers shared read-only checkouts and inherited the parent model and effort. No alternate-model diversity is claimed.
The parent ran CLI version and help checks, both existing live catalog contracts, and a bounded no-prompt Codex model-list probe.
The joint live catalog command exited 101 because Copilot failed. Claude passed.
No authenticated generation, UI prototype, model-switch test, entitlement matrix, or performance comparison ran.
Raw account and credential payloads were not saved.

Local receipts are in `/tmp/qa-scribe-model-investigation-20261016/`.
The execution plan is [CLI model management plan](../cli-model-management-plan.md).

Independent review passed after correcting the plan's distinction between cached readiness reads and explicit Refresh.
The same reviewer checked the later Copilot Auto amendment.
Review used an inherited model, with no independent model-family diversity claim.
Remaining attention items are Copilot catalog authorization, supported-floor Auto behavior in generation and ACP Chat, and the uncompleted provider rollout matrix.
