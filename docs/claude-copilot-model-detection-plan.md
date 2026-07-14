# Claude Code and GitHub Copilot model discovery plan

Status: implemented; selector release remains externally gated
Date: 2026-07-13
Branch: `codex/claude-copilot-model-detection`

Implementation evidence, compatibility floors, rollout controls, fixture
refresh instructions, live-test commands, and outstanding external release
gates are recorded in
[`provider-catalog-contract.md`](provider-catalog-contract.md). The code defaults
to diagnostic rollout until those gates are satisfied.

## Decision

QA Scribe can technically discover Claude Code and GitHub Copilot models with roughly the same authority as its current Codex integration.

- Claude Code exposes the signed-in model picker through the Agent SDK initialization result (`supportedModels()`). A local, no-prompt handshake against Claude Code 2.1.50 returned structured model IDs, labels, descriptions, effort levels, and capability flags.
- GitHub Copilot exposes an account-resolved catalog through the official Copilot SDK `listModels()` method, backed by the CLI runtime's `models.list` JSON-RPC request. Its metadata is at least as rich as the current Codex descriptor.

The remaining asymmetry is effective-default provenance. Both providers can report a useful catalog, but neither stable catalog API fully explains every user, repository, enterprise-policy, environment, and fallback layer. QA Scribe must report only the origin it can prove and label the remainder conservatively.

There is also a Claude release-policy gate: Anthropic's Agent SDK guidance restricts third-party products from offering Claude.ai login or subscription rate limits without approval. QA Scribe uses the user's separately installed and authenticated CLI rather than offering login, but that interpretation must be confirmed with Anthropic before shipping subscription-backed discovery.

The implementation should therefore aim for catalog parity first, followed by default-provenance improvements. It must never send a prompt, consume model usage, expose credentials, or turn discovered state into an explicit execution override.

## Scope

This plan covers the standalone `claude` and `copilot` CLIs. It does not cover the retired `gh copilot` extension or attempt to enumerate arbitrary BYOK provider endpoints.

The research used both Exa and Ref to locate and cross-check official documentation, SDK source, release notes, protocol schemas, and relevant upstream issues. Local commands were read-only and sanitized. Claude Code was available for a live initialization probe; Copilot was not installed on the research host, so its live contract remains a Phase 0 verification item.

## What “as well as Codex” means

| Property | Required parity contract |
| --- | --- |
| Catalog authority | Prefer the provider's structured, signed-in catalog over help text or shipped presets. |
| Model identity | Preserve the exact value accepted by the CLI and provide a human-readable label when available. |
| Account and policy awareness | Distinguish account-available models from models merely recognized by the installed binary. Preserve disabled or unconfigured policy states when returned. |
| Metadata | Preserve descriptions, capability flags, effort options, and token limits when supplied; never invent missing values. |
| Default intent | Keep provider-managed `default` or `auto` distinct from an explicit model ID. Never infer a default from catalog order. |
| Provenance | Report a source only when it is proven: CLI argument, environment, user configuration, repository configuration, managed/provider fallback, or unknown. |
| Lifecycle | Expose loading, fresh, stale, unavailable, and failed states independently of the general provider snapshot. |
| Safety | Use a neutral empty working directory, send no prompt, create no conversation by default, read no token values, bound time/output, and sanitize errors. |
| Compatibility | Version-gate structured adapters, tolerate optional/unknown fields, and keep help parsing plus presets as lower-confidence fallbacks. |
| User control | Preserve free-form custom model IDs even when they are absent from the detected catalog. |

## Baseline implementation and gaps

This section records the pre-implementation state that motivated the phased
work. The branch implementation and its remaining external release gates are
described in `provider-catalog-contract.md`.

Codex already uses a structured `codex app-server` session, initializes it, reads configuration, and paginates `model/list` in [`probe.rs`](../src-tauri/src/commands/providers/probe.rs). [`models.rs`](../src-tauri/src/commands/providers/models.rs) treats that live catalog as authoritative before falling back to `codex debug models` and presets.

Claude and Copilot currently rely on weaker evidence:

- Claude combines `ANTHROPIC_MODEL`, a default sentinel, presets, and scraped `claude --help` examples.
- Copilot combines `COPILOT_MODEL`, settings, `auto`, presets, and scraped `copilot help` output.
- `ProviderModelDescriptor` has only a coarse detected source, so structured account results and help-derived guesses look equally authoritative.
- Model-catalog freshness is coupled to the broader provider snapshot. A fast snapshot can look fresh before deep catalog discovery has run, so the frontend may not trigger the richer probe until a manual refresh.
- The generic help probes and some default-resolution paths inherit the application working directory even though the public snapshot claims neutral scope. Generation already uses a neutral provider directory; discovery must use the same boundary.
- Raw CLI error output can reach cached/UI-visible status fields. Auth and protocol diagnostics need a sanitized public reason separated from local raw diagnostics.
- Existing request timeouts are not a whole-transaction deadline; pagination or repeated reads can accumulate beyond the intended limit.

These are shared substrate problems, not provider-specific exceptions, and should be fixed before adding new adapters.

## Provider findings

### Claude Code

The official Claude Agent SDK exposes `supportedModels()` and includes a structured `models` array in its initialization result. Current `ModelInfo` records include a selection value, display name, description, effort support and levels, adaptive-thinking support, and evolving mode flags.

A local probe against Claude Code 2.1.50 started the CLI in stream-JSON SDK mode, sent only an initialization control request, and retained only the returned model array. It returned:

- `default` — “Default (recommended)”, with a current Sonnet description and effort metadata;
- `opus` — a current Opus picker entry;
- `haiku` — a current Haiku picker entry.

No user prompt was sent, no model usage was incurred, no session was persisted, and account fields were discarded. A follow-up hardened variant used empty setting sources, disabled hooks, commands, and tools, and supplied a strict empty MCP configuration.

This hardening is mandatory. An ordinary initialization that loaded the research account's normal settings ran configured `SessionStart` hooks even though no prompt was sent. Discovery must therefore not load executable user settings through the CLI. QA Scribe can read and validate relevant declarative model settings separately, as it already does, without allowing hooks to execute. Endpoint/server-managed policy can still apply even with empty local setting sources.

Important limits:

- The supported semantic surface is the Agent SDK. Claude has no official Rust SDK, and the CLI control transport used by the SDK is not separately promised as a stable public protocol. A Rust implementation must be version-gated, fixture-tested, and able to fall back cleanly.
- Picker models are not necessarily every free-form alias or provider-specific model the CLI accepts. Custom entry must remain available.
- Organization settings such as `availableModels` and `enforceAvailableModels`, account/provider selection, and managed defaults affect the result. A local allowlist test filtered the initialization catalog as expected, but production discovery must reproduce safe declarative filtering without executing settings hooks.
- Initialization returns a model catalog and account metadata, but not the active configured model or its provenance. The `default` row is provider-managed intent, not proof that it is currently selected.
- Auth mode can change the catalog from a Claude subscription to an API key, Bedrock, Vertex, Foundry, or a gateway. Inherited `ANTHROPIC_API_KEY` is particularly important; cache and provenance must distinguish the provider/auth class without retaining any credential value.
- Newer Claude versions add fields such as `resolvedModel`, fast-mode support, and auto-mode support. `resolvedModel` explains alias resolution; it must not replace the submitted `default` or alias value.
- The TypeScript SDK's current alpha `resolveSettings()` API exposes effective settings and provenance without spawning the CLI. It is promising for later default-resolution work, but an alpha JS sidecar is not a suitable Phase 1 dependency.
- Anthropic's public `/v1/models` API describes the API credential's canonical model access, not Claude.ai subscription entitlements, CLI aliases, organization defaults, local allowlists, or cloud-provider deployment IDs. It is not a replacement for CLI discovery.

Recommended cascade:

1. Resolve the exact installed `claude` executable and version.
2. Start it in an empty neutral directory using the documented Agent SDK stream-JSON mode, with empty setting sources, hooks and slash commands disabled, no tools, strict empty MCP configuration, and session persistence disabled.
3. Send only the initialization control request, parse only the bounded model result, then terminate the process tree.
4. Whitelist and discard any auth/account metadata, then map the structured result to `cliCatalog` descriptors and preserve optional capabilities.
5. Resolve declarative user model restrictions/defaults separately without executing configured hooks.
6. If the version or handshake is unsupported, fall back to `--help` as `supportedByBinary`, then to shipped presets as `staticHint`.

### GitHub Copilot CLI

The official GitHub Copilot SDK exposes `listModels()` (Rust: `Client::list_models()`), backed by the CLI runtime's `models.list` JSON-RPC request. It starts or connects to the Copilot CLI, uses the CLI's logged-in account, and does not require a session or prompt.

The stable public model contract includes technical ID, display name, vision and reasoning capabilities, supported/default reasoning efforts, prompt/context and vision limits, optional policy/terms, and optional billing metadata. Generated protocol types contain additional optional fields, but QA Scribe should not make experimental fields part of its required contract.

Important limits:

- There is no documented standalone `copilot models list --json` command. The interactive `/model` picker cannot be used safely as an automation surface.
- `copilot help` and shell completions show values recognized by the installed binary, not necessarily models available to the signed-in account, plan, client, or organization policy.
- The SDK catalog is the strongest supported account catalog, but GitHub does not guarantee byte-for-byte identity with every client-side filter in the visible TUI picker.
- `listModels()` does not declare the current/default model or its source. `auto` is a documented selection sentinel and must be represented separately when necessary; catalog order is not default evidence.
- Experimental `user.settings.get` can describe user-setting values and defaults, but explicitly omits repository and enterprise-managed overrides. A zero-message session plus `model.getCurrent` can reveal final selection but creates local session state, so it should not be in the default catalog path.

Recommended cascade:

1. Resolve the exact installed `copilot` executable and version.
2. Start the official stable Rust SDK against that executable, with CLI bundling disabled and an empty neutral working directory.
3. Check runtime and authentication status, call `list_models()`, preserve policy state and optional metadata, then shut down the short-lived client.
4. Resolve only provable default layers from controlled arguments, environment presence, and supported settings APIs. Report unresolved managed/server fallback as partial or unknown.
5. If the CLI/SDK contract is incompatible, parse help or completion output as `supportedByBinary`, then use presets as `staticHint`.

Phase 0 must compare the stable Rust SDK with a minimal direct JSON-RPC adapter. The SDK is preferred if its dependency and binary-size delta is acceptable; direct protocol code is acceptable only if it proves materially smaller and carries explicit compatibility fixtures. In either case, QA Scribe must point at the user's detected CLI instead of silently using a bundled version.

## Recommended architecture

Catalog discovery and default resolution should be separate domain objects. A provider can have a fresh account catalog while its effective default origin is only partially known, or a valid default while the network catalog is stale.

Introduce a catalog snapshot equivalent to:

```text
ProviderModelCatalogSnapshot
  provider
  state: idle | loading | fresh | stale | unavailable | failed
  source: cliCatalog | cliHelp | config | environment | preset
  models[]
  checkedAt
  cliVersion
  scope: neutral
  publicReason?
  warnings[]
```

Extend model descriptors only with provider-neutral optional fields that the UI can explain, for example:

- availability: available, policyDisabled, unconfigured, supportedByBinary, or staticHint;
- description and display label;
- reasoning/effort options and default effort when explicitly supplied;
- capability flags such as vision, adaptive thinking, and fast/auto mode;
- context/output limits when supplied;
- evidence source and confidence.

Do not expose raw transport records directly to the frontend. Retain unknown fields in versioned internal fixtures if useful, but keep the application DTO small and stable.

All structured adapters should share:

- `NeutralProviderCwd` for the entire probe and default-resolution chain;
- executable/version capture and compatibility classification;
- a whole-transaction deadline, bounded frames/pages/model count/output, and descendant-process termination;
- sanitized user-facing errors plus redacted local diagnostics;
- a cache key that includes provider, executable identity/version, auth/account fingerprint that contains no credential, and discovery schema version;
- short-lived clients so account switches and policy changes do not retain stale SDK caches;
- the invariant that discovery never changes execution arguments.

## Phased implementation plan

### Phase 0 — Lock the parity and safety contract

Goal: replace research assumptions with reproducible fixtures before production DTO changes.

Work:

- Add a small read-only spike for Claude initialization and Copilot `listModels()` using the exact installed binaries from a neutral directory.
- For Claude, compare a pinned public Agent SDK sidecar with a minimal Rust initialization transport. For Copilot, compare stable Rust SDK usage with `default-features = false` against a minimal transport adapter. Record dependency, packaging, binary-size, startup-time, cancellation, and compatibility costs for both decisions.
- Capture fully sanitized fixtures for success, unauthenticated, policy-disabled, incompatible-version, timeout, malformed-frame, and empty-catalog cases.
- Prove that hardened Claude initialization cannot run user hooks, commands, tools, or MCP servers, including hostile fixture settings.
- Compare structured results with each visible model picker on at least one signed-in account. For Copilot, install or provide the CLI only in an explicit test environment; do not make installation an application behavior.
- Confirm with provider billing/usage telemetry that catalog calls incur no model usage. Treat zero-message session probes as opt-in until this is proven.
- Write the accepted version floor and fallback matrix.
- Confirm Anthropic's authorization position for discovery through a separately authenticated Claude Code subscription before choosing a release scope.

Exit gate:

- Both probes produce a bounded catalog without a prompt or persistent conversation.
- Claude fixture hooks and tools cannot execute during discovery.
- Sanitized fixtures contain no token, email, login, organization, path, prompt, or repository content.
- The Claude and Copilot integration choices are documented with measured costs, and the Claude release-policy decision is recorded.

### Phase 1 — Build the neutral discovery substrate

Goal: make catalog authority, lifecycle, and safety provider-neutral.

Work:

- Add the catalog snapshot, availability, evidence-source, confidence, capability, and sanitized-error types in [`types.rs`](../src-tauri/src/commands/providers/types.rs).
- Separate model-catalog cache/freshness from the provider/default snapshot in [`cache.rs`](../src-tauri/src/commands/providers/cache.rs) and the frontend status cache.
- Route all deep probes and default resolution through `NeutralProviderCwd`; remove process-CWD leakage.
- Add a transaction supervisor with absolute deadline, frame/page/model/output bounds, and process-tree cleanup.
- Add executable/version and redacted auth-state inputs to cache invalidation without storing secrets.
- Preserve current DTOs during migration so Codex behavior does not regress.

Exit gate:

- Fast discovery cannot mark an unrun deep catalog as fresh.
- Neutral-scope tests prove repository and local settings do not affect the catalog probe.
- Timeout, cancellation, cache, and error-redaction tests pass for all providers.

### Phase 2 — Add Claude's structured catalog adapter

Goal: replace Claude help scraping as the primary source.

Work:

- Implement the version-gated, initialization-only adapter behind a small transport trait.
- Enforce empty CLI setting sources, disabled hooks/commands/tools, strict empty MCP configuration, and no persistence in the process builder and tests.
- Parse required identity fields and optional metadata defensively; ignore unknown additions.
- Map picker restrictions and effort/capability fields to the shared descriptor.
- Keep `--help` parsing and presets as explicitly lower-confidence fallbacks.
- Keep environment/settings default resolution separate from catalog results; declaratively apply safe model allowlists, distinguish provider/auth class, and do not convert `default` or a resolved alias into a concrete explicit override.
- Add golden fixtures for supported releases plus malformed, partial, unsupported, timeout, and authentication cases.

Exit gate:

- On a signed-in supported CLI, QA Scribe matches the visible picker for the tested account or records a documented provider discrepancy.
- Unsupported or offline CLIs degrade to labeled help/preset results without blocking settings.
- Custom model entry and existing generation argument behavior remain unchanged.

### Phase 3 — Add Copilot's structured catalog adapter

Goal: use the signed-in account and policy catalog as the primary source.

Work:

- Implement the Phase 0 SDK/transport decision against the exact detected CLI path with bundling disabled.
- Check runtime/auth status, call `models.list`, preserve policy state, and close the client after discovery.
- Keep `auto` as provider-managed intent and synthesize it only when the public contract requires it; never infer a default from model order.
- Optionally enrich user-level default evidence through a supported settings call when the installed version supports it. Keep zero-message session creation behind an explicit experimental flag.
- Label help/completion results `supportedByBinary` and presets `staticHint`.
- Add fixtures for account switching, policy-disabled models, missing optional metadata, rate limiting, network/proxy failures, incompatible protocols, and stale SDK cache.

Exit gate:

- A live signed-in test returns account-resolved models and exposes policy-disabled entries accurately.
- Auth, policy, network, rate-limit, and version failures remain distinguishable.
- No credential values, signed traffic, or raw stderr reach the normal UI or persisted cache.

### Phase 4 — Expose authority and freshness in the UI

Goal: make the richer result understandable without turning settings into a diagnostic console.

Work:

- Update the settings discovery hook so deep catalog discovery runs independently of the fast provider snapshot.
- Show concise states such as “available for this account,” “recognized by CLI,” “disabled by policy,” “static fallback,” and “last checked.”
- Keep provider-managed Default/Auto visually distinct from an explicit model override.
- Preserve the custom-model escape hatch and warn, rather than block, when a custom ID is absent from the current catalog.
- Surface sanitized recovery actions for sign-in, update, policy, network, or retry cases.
- Avoid displaying billing metadata until product requirements and field stability justify it.

Exit gate:

- The UI never presents help-derived or preset entries as account-confirmed.
- Refresh, stale-cache, account-change, offline, and custom-model scenarios have deterministic tests.
- Existing Codex model selection and default behavior remain unchanged.

### Phase 5 — Compatibility and release gate

Goal: ship the feature with a maintained provider contract rather than a one-release parser.

Work:

- Add opt-in live contract tests for supported Claude and Copilot CLI versions on macOS, Linux, and Windows.
- Test representative Claude account/provider restrictions and Copilot Free, Pro, Business, Enterprise, disabled-policy, data-residency, and account-switch cases where test accounts are available.
- Verify the Claude release-policy decision and test hostile user settings that define hooks, commands, and MCP servers.
- Record startup latency, binary-size/dependency delta, timeout rate, fallback rate, and sanitized failure category.
- Add fixture refresh instructions and an owner/checklist for provider protocol changes.
- Amend ADR 0010 to state the catalog/default separation, neutral-scope invariant, privacy boundary, and fallback authority order.
- Roll out behind a provider-catalog feature flag, first as diagnostics and then as the default selector source after telemetry is clean.

Exit gate:

- All supported-platform fixtures and targeted live tests pass.
- No prompt, usage, credential, repository-content, or raw-diagnostic leakage is observed.
- Fallback behavior works on the oldest supported CLI versions and the ADR is updated.

## Test matrix

At minimum, automated coverage should include:

| Dimension | Cases |
| --- | --- |
| Catalog | structured full, structured partial, empty, unknown fields, duplicate IDs, large/bounded response |
| CLI | missing, unsupported old, current, newer protocol, corrupt output, crash, hang |
| Account | signed out, signed in, switched account, expired auth, alternate GitHub host |
| Policy | available, disabled, unconfigured, picker/catalog discrepancy |
| Network | offline, proxy/TLS failure, rate limit, transient server error |
| Scope | neutral directory, repository settings present elsewhere, local settings present elsewhere |
| Defaults | provider-managed, environment, user setting, repository/local excluded by neutral scope, unknown managed fallback |
| Cache | cold, fresh, stale, CLI upgrade, account/policy change, failed refresh with stale data |
| Privacy | token-like stderr, account data, paths, repository content, oversized diagnostics |
| Runtime | deadline, cancellation, process-tree cleanup, app shutdown during discovery |
| UI | authority labels, stale state, recovery actions, custom ID, no explicit override |

The existing targeted provider tests are the regression baseline: 25 Rust provider tests and 17 targeted frontend settings/discovery tests passed before this plan was written.

## Explicit no-go approaches

- Do not send a natural-language prompt asking either CLI to list models.
- Do not scrape an interactive TUI, synthesize keystrokes, or intentionally pass an invalid model to mine an error message.
- Do not extract stored access tokens or call undocumented provider endpoints directly.
- Do not use Anthropic's `/v1/models` API as evidence for Claude Code subscription or picker availability.
- Do not treat `--help`, completions, shipped presets, or the public GitHub Models REST catalog as account entitlement evidence.
- Do not silently use an SDK-bundled Copilot runtime when the UI claims to inspect the user's installed CLI.
- Do not create a Copilot session merely to enrich the normal catalog unless its persistence and zero-usage behavior are proven and accepted.
- Do not let catalog contents replace provider-managed Default/Auto intent or block a valid custom model ID.
- Do not expose raw provider stderr, account identity, organization policy text, or protocol payloads in cached user-facing diagnostics.

## Primary sources

Claude:

- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
- [Claude Agent SDK for TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Claude Agent SDK Python query implementation](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py)

GitHub Copilot:

- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
- [SDK compatibility guidance](https://github.com/github/copilot-sdk/blob/main/docs/troubleshooting/compatibility.md)
- [Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [Copilot CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)
- [Copilot CLI configuration reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
- [Supported Copilot models](https://docs.github.com/en/copilot/reference/ai-models/supported-models)
- [Configuring model access and policy](https://docs.github.com/en/copilot/how-tos/use-ai-models/configure-access-to-ai-models)
- [Copilot SDK client implementation](https://github.com/github/copilot-sdk/blob/main/nodejs/src/client.ts)
- [Copilot SDK public model types](https://github.com/github/copilot-sdk/blob/main/nodejs/src/types.ts)
- [Request for a standalone model-list command](https://github.com/github/copilot-cli/issues/700)

These sources establish the supported semantic surfaces. Generated RPC schemas and upstream issue reports are useful compatibility evidence, but are not promoted to stable product contracts by this plan.
