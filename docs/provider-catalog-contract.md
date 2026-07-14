# Provider catalog compatibility and release contract

Status: implemented, release-gated
Owner: QA Scribe maintainers
Last verified: 2026-07-14

This document records the Phase 0 transport decisions, compatibility floor,
fixture workflow, rollout controls, and release evidence for Claude Code and
GitHub Copilot model discovery. The implementation is in
`src-tauri/src/commands/providers/probe/`.

## Transport decision and measured cost

Both integrations use small Rust transports against the exact CLI executable
already resolved by QA Scribe. Neither transport sends a prompt, creates a
conversation, reads credential values, or uses an SDK-bundled CLI.

| Provider | Decision | Why | Measured implementation cost |
| --- | --- | --- | --- |
| Claude Code | Initialization-only stream-JSON transport compatible with the Agent SDK semantic surface | Anthropic has no Rust Agent SDK. A JavaScript sidecar would add a second packaged runtime and would not improve process-group cleanup. The control transport is therefore isolated, version-gated, and fixture-tested. | Zero Cargo dependencies and zero packaged sidecars. Live Claude Code 2.1.50 returned 3 sanitized models in 298–554 ms across three macOS arm64 runs. |
| GitHub Copilot | Minimal protocol-3 `--server --stdio --no-auto-update` adapter | The official Rust SDK was still `1.0.7-preview.2` during evaluation, adds an HTTP/WebSocket dependency surface, and owns a Tokio child that QA Scribe cannot place in its process group. The adapter implements only `connect`, `status.get`, `auth.getStatus`, `models.list`, and best-effort `runtime.shutdown`. | Zero Cargo dependencies and zero bundled runtime. Live latency is not yet measured because Copilot was not installed on the verification host. |

An isolated optimized build against `origin/main` used the same frontend assets
and Rust 1.97.0. The baseline `qa-scribe-tauri` binary was 16,181,728 bytes; the
complete provider-catalog implementation was 16,662,352 bytes, a 480,624-byte
(2.97%) increase. Clean release builds took 70.48 s and 72.86 s respectively.
This delta covers the shared DTO/cache/UI contract and both transports, not just
protocol code. `Cargo.toml` and `Cargo.lock` have no dependency changes.

Cancellation and compatibility costs are controlled by the same substrate for
all providers: a 12-second absolute transaction deadline, 4-second command
slices, 1 MiB output/frame budget, 1,000-model limit, bounded queues/pages, and
process-group termination on success, timeout, malformed input, or drop.

## Compatibility and fallback matrix

| Provider | Structured compatibility | Lower-authority fallback |
| --- | --- | --- |
| Codex | Existing `codex app-server` initialize/config/model-list contract | `codex debug models`, then curated presets |
| Claude Code | Version 2.1.50 or newer plus a successful initialization control response | `claude --help` as `supportedByBinary`, then curated presets as `staticHint` |
| GitHub Copilot | Server protocol 3 with authenticated `models.list` | `copilot --help` as `supportedByBinary`, then curated presets as `staticHint` |

Unknown optional fields are ignored. Required-field or protocol failures are
sanitized and fall back without blocking custom model entry. Claude
`resolvedModel` remains metadata; Copilot `auto` and every provider's `default`
remain provider-managed intent.

Claude's declarative `availableModels` filter is read without executing settings
hooks. It supports family names, version prefixes, and exact IDs; a specific
version disables a same-family wildcard, and an empty list hides named choices
while retaining the provider-managed Default row. Setting
`enforceAvailableModels` to `false` does not disable the named-model allowlist.

The cache key hashes the discovery schema, provider, exact executable metadata,
relevant settings/credential-file metadata, and only the presence of auth-mode
environment variables. It never stores environment-variable values. A failed
refresh may reuse a last-good catalog only when that fingerprint still matches,
so an account or auth-mode switch cannot inherit the previous account's stale
catalog.

That identity proof exists only in the backend process. The persisted frontend
startup cache therefore never stores `cliCatalog` entries and never replays a
catalog across an app restart; it restarts catalog discovery as `idle` while it
may still reuse separately sanitized default observations. The cache rebuilds
an allowlisted snapshot rather than retaining unknown legacy fields: provider
identity and categorical default provenance are kept, while commands, raw
warnings, catalogs, CLI versions, unknown fields, and absolute paths are
dropped. The normal bridge DTO also omits executable paths and technical
configuration paths entirely. Exact paths remain backend-only inputs to
executable resolution and process launch.

## Rollout

Set `QA_SCRIBE_PROVIDER_CATALOG_MODE` before launching QA Scribe:

- `disabled` or `off`: do not run the new Claude/Copilot structured adapters;
  use compatibility choices. This is the release kill switch.
- unset, `diagnostics`, or an unknown value: discover and display catalog health,
  but retain compatibility choices as the selector projection.
- `selector`, `enabled`, or `on`: use structured Claude/Copilot catalogs as the
  model selector source.

Codex behavior is unchanged by this flag. Promote a release from diagnostics to
selector only after the live matrix below is green and sanitized failure/fallback
rates are acceptable.

## Deterministic fixtures

Sanitized fixtures live under
`src-tauri/src/commands/providers/probe/fixtures/{claude,copilot}`. They cover
full and partial catalogs, unknown fields, empty and oversized catalogs,
malformed frames, incompatible protocols, authentication failures, policy
states, duplicates, and classified provider errors. Tests also prove the exact
read-only request surface and reject token, login, email, host, prompt,
repository, terms, and billing fields.

To refresh fixtures:

1. Use a disposable test account and non-repository neutral directory.
2. Capture only the initialization or model-list response needed by the parser.
3. Replace every account, organization, host, path, credential, billing, prompt,
   repository, and provider-private value with inert synthetic data.
4. Keep unknown-field sentinels so forward-compatible parsing remains tested.
5. Run the focused provider tests, `git diff --check`, the privacy scans in the
   fixture tests, and the full repository verification gate.
6. Record the CLI version, protocol/schema change, platform, and reason in the
   pull request. Never commit a raw capture.

## Opt-in live contracts

Live tests are ignored by default and require an exact executable path. They use
the same no-prompt transport as production:

```bash
QA_SCRIBE_LIVE_CLAUDE_PATH=/absolute/path/to/claude \
  cargo test -p qa-scribe-tauri \
  commands::providers::probe::claude::tests::live_authenticated_catalog_contract \
  -- --ignored --exact --nocapture

QA_SCRIBE_LIVE_COPILOT_PATH=/absolute/path/to/copilot \
  cargo test -p qa-scribe-tauri \
  commands::providers::probe::copilot::tests::live_authenticated_catalog_contract \
  -- --ignored --exact --nocapture
```

Two 2026-07-13 Claude runs and a 2026-07-14 follow-up passed on macOS arm64 with
Claude Code 2.1.50; the follow-up returned 3 models in 359 ms. Copilot was not
installed and remains unverified live. Do not install or authenticate a provider
as an application behavior or required deterministic CI step.

## Release evidence checklist

Before selector rollout, record the following outside committed fixtures:

- macOS, Linux, and Windows results at the oldest supported and current CLI;
- picker/catalog comparison for at least one signed-in Claude account and one
  signed-in Copilot account;
- Claude API-key/cloud-provider/allowlist cases and representative Copilot Free,
  Pro, Business, Enterprise, policy-disabled, data-residency, alternate-host,
  and account-switch cases when accounts are available;
- hostile Claude settings containing hooks, commands, tools, and MCP servers;
- startup latency, timeout rate, sanitized error category, fallback rate, and
  the release binary-size delta;
- provider billing/usage telemetry confirming catalog-only calls incur no model
  usage; and
- Anthropic's written authorization position for discovery through a separately
  authenticated Claude Code subscription.

The last two items and the multi-platform/account matrix are external release
gates. They are intentionally not claimed by fixture tests. Until they are
complete, keep the default in diagnostics and do not market subscription-backed
Claude discovery as generally released.
