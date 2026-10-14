# Multi-provider Session Chat tool authorization

Replacement Flow session: `session:48189406-0811-4c59-b484-abe4f42a7db5`.
Approved at revision 2. Previous session was deferred, not completed.

## Delivery checklist

- [x] `auth-compatibility`: verify Claude/Codex native approval, isolated authentication/discovery failures and the Copilot ACP contract; explicitly defer authenticated Copilot proof.
- [x] `auth-contract`: add trusted Chat authorization state and attempt-bound decisions; prove stale decisions, provider/Session mismatch, cancellation, deletion and restart cannot grant access.
- [x] `auth-adapters`: implement each proven provider mechanism; use real child-process red/green checks to prove exact tool approval, policy denial, final answers and cleanup.
- [x] `auth-ui`: expose shared approve, deny, cancel and explicit retry/recheck actions with accurate provider-specific grant scope; verify UI interaction and persistence.
- [x] `auth-behavior-proof`: run deterministic built-app workflows for all three providers, authenticated candidate-app harmless MCP smokes for Claude/Codex, conditional configured Jira workflows, and `bun run verify`; hosted macOS coverage precedes publication.
- [ ] `auth-release-preparation`: recheck remote versions, prepare the next stable version through `bun run bump`, verify metadata and canonical checks, independently review and push the release PR, and observe protected CI success.
- [ ] `auth-release-publication`: after separately authorized merge, verify the automatic exact-merge tag, successful actual Release run, non-draft release assets and signed live APT version.

## Design decisions

Use one Session Chat approval workflow with small provider-specific adapters.
CLI authentication and connector configuration remain provider-owned. Approval
requests come from trusted backend/provider state, never assistant instructions.
Show the provider, configured connector, exact tools, available arguments and
effective scope. An exact-tool process allowance is not a single-call grant.
App grants are ephemeral and bound to the active attempt. Respect existing
policy and do not automatically retry arbitrary side effects.

Use Claude native stream-json control, Codex app-server stdio and Copilot ACP
for Chat-only duplex adapters. Retain writable stdin for correlated responses,
bounded concurrent reads and cancellation/process-group cleanup. Keep ordinary
generation defaults. Native single-invocation decisions do not add tool grants.
Copilot live execution is unavailable and explicitly deferred by user direction;
its protocol/process/UI coverage is deterministic and never labelled live proof.

The canonical gate is `bun run verify`. Authenticated Claude/Codex candidate-app
harmless MCP smokes remain required. Exercise Jira when configured, otherwise
record that workflow unverified. Copilot live testing is not a release blocker.
Preserve existing edits in `docs/chat-tools-plan.md` and `docs/session-chat-plan.md`.

The next release is provisionally 0.8.2, subject to remote version checks.
Follow `docs/releasing.md`: release PR, protected CI, separately authorized
merge, automatic merge-SHA tag and actual publication verification.

## Research references

- Claude headless CLI: <https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless>
- Current Claude policy precedence: <https://code.claude.com/docs/en/permissions>
- Codex app-server: <https://developers.openai.com/codex/app-server>
- Codex noninteractive execution: <https://developers.openai.com/codex/noninteractive>
- Copilot exact MCP tool filters: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference>
- Copilot ACP: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server>
- ACP permissions: <https://agentclientprotocol.com/protocol/tool-calls>

## Status

Compatibility passed independent review at revision 11; backend lifecycle
passed at revision 25. Native adapters passed independent retry review at
revision 46. Approval UI passed independent review at revision 76. F5 passed
independent review `review:fab4754e-096d-4ec9-a1fc-73805974a796` at revision 94.
F6 release preparation is active; F7 publication remains unchecked. Two units
remain unchecked: release preparation and publication.
Current-source validation `73f3056a` passed isolated failure observations and
all six Claude/Codex live marker probes. Review advisories: retain reproducible
live fixtures for candidate-app proof and bound the optional probe's overall
deadline before relying on it for later validation.

## Compatibility and classification contract

Historical observations from the deferred session, not candidate-app evidence:

| Provider | Version | Native approval transport | Observation |
| --- | --- | --- | --- |
| Claude Code | 2.1.299 | stream-json `control_request` / `can_use_tool` | Local marker tool executes once on allow, zero on deny/exclusion. |
| Codex CLI | 0.162.1 | stdio `mcpServer/elicitation/request` | Local marker executes once on accept, zero on decline/`disabled_tools`. |
| Copilot CLI | 1.0.69 | ACP `session/request_permission` | Handshake succeeds; account policy blocks model requests before tools. Live approval is deferred. |

Claude passes `--input-format stream-json --permission-prompt-tool stdio` and
initializes the SDK control protocol. Return the original input on allow;
never send `updatedPermissions`. Codex uses ephemeral threads and installed
`on-request`/`read-only` enums. Its native MCP elicitation is experimental;
unsupported schemas must fail visibly. Exact tool identity may exist only in
provider description, which is displayed as such, never parsed into authority.
Copilot chooses only offered `allow_once`/`reject_once` options and echoes their
actual option IDs. Unknown requests/options cannot become automatic approvals.

`auth-compatibility.R14-01` remains historically unproved and is explicitly
deferred only for authenticated Copilot execution. Replacement acceptance still
requires Copilot adapter, process and UI tests.

For `auth-compatibility.R14-02`, observe isolated auth/configuration failures
with `python3 scripts/chat-authorization-probe.py`. It makes no model request,
uses temporary configuration homes, and never changes saved credentials.
CLI configuration absence is distinct from a remote connector's OAuth state.
Use native auth/discovery/protocol errors where available. A hidden tool can
result from policy or missing configuration, so assistant claims cannot classify
the cause. Preserve unresolved provider errors as provider errors rather than
guessing missing connector or auth failure. Protocol error codes/terminal
statuses are evidence; model prose alone is not. Copilot's observed account
policy error is historical, not a future protocol guarantee.

Replacement-session observations: isolated Claude reports `loggedIn:false`
with exit 1; isolated Codex reports `Not logged in` with exit 1. All three
CLI `mcp get qa_scribe_missing` commands reject configuration absence with
exit 1. Codex and Copilot initialized transports reject an unsupported method
with JSON-RPC -32600 and -32601 respectively. These observations distinguish
the inspected states, not every remote connector OAuth failure. The Vite+
Codex shim needs the original HOME for executable resolution; CODEX_HOME
still isolates authentication. Closing stdin before a protocol response can
drop replies, so the probe keeps it open until the correlated reply arrives.

Final compatibility check commands (opt-in live probes use the previously
inspected harmless local MCP fixture, never Jira or saved permission edits):

```bash
python3 scripts/chat-authorization-probe.py
claude --version && codex --version && copilot version
python3 /tmp/opencode/qa-scribe-authorization-probe.py claude allow
python3 /tmp/opencode/qa-scribe-authorization-probe.py claude deny
python3 /tmp/opencode/qa-scribe-authorization-probe.py claude policy
python3 /tmp/opencode/qa-scribe-authorization-probe.py codex allow
python3 /tmp/opencode/qa-scribe-authorization-probe.py codex deny
python3 /tmp/opencode/qa-scribe-authorization-probe.py codex policy
```

The ACP representative shape check uses opaque option IDs and does not claim
to exercise the app adapter or an authenticated Copilot permission. Those
deterministic process and UI acceptance checks belong to later phases.

## Authorization lifecycle evidence

Behavioral red `c674cdb5`: the new APIs compiled but 9 of 11 checks failed
against error-only placeholders. Green `3d0e09bb`: all 11 permission checks
passed after implementation, including forged/stale identities, duplicate
decisions, cancellation/deletion/terminal invalidation and cancel/decision race.
Pending requests are memory-only, carry fresh backend UUID tokens, and retain
original provider metadata; frontend decisions cannot replace that metadata.

Canonical failures identified required binding/command-surface prerequisites:
regenerate the actual `frontend/src/bindings.ts`, register the command in
Specta and the explicit app manifest, and add its exact main-window default
permission. Recorded same-goal amendments retain all tests and the gate.
The publication API has a temporary non-test lint expectation until the next
approved adapter feature consumes it; it must be removed on integration.
Canonical `340cc2d5` passed: 391 frontend, 176 core, 98 integration/storage
and 185 Tauri checks passed; three pre-existing optional live tests were ignored.
Audit, metadata, bindings, command surface, formatting, clippy, build and smoke
passed. Independent review `e458b25a` found no F2 blockers or advisories.

## Native adapter evidence

Core protocol red `d04d7c8e` and real-process red `9671e77f` compiled but
failed against the staged placeholders. Driver checks exercise actual Python
child processes, permission responses and execution markers for all providers;
they are deterministic protocol fixtures, not authenticated Copilot proof.
Additional red `11320094` reproduced flattened installed Codex permission
fields, early ACP command discovery, and Claude stream-reset defects. Red
`f9d20f2c` reproduced lost reported-model metadata and oversized UTF-8 error
diagnostics. Green `1e83d791` passed 27 core and 10 process checks after fixes.
Red `9146665d` then reproduced the documented ACP partial-tool-call case;
the adapter now retains bounded matching-session display metadata by tool-call
ID without deriving permission authority from it.

Chat uses native duplex transport and the original one-shot helper remains
test-only for regression coverage. Ordinary generation retains its transport.
Temporary publication lint expectations were removed on adapter integration.
Every return stops/reaps the process group and revokes pending local decisions;
provider cancellation and duplicate requests are read while approval is pending.

Independent F3 review found `auth-adapters.R39-01`: an exited parent with a
descendant retaining pipes could leave approval active until the watchdog.
It also found `auth-adapters.R39-02`: continuous notifications could starve
decision delivery. Red `f687c874` reproduced both with real child fixtures.
Green `eba2ef28` passed all 13 process checks after per-loop parent-exit
observation, immediate pending revocation, bounded buffered-terminal draining
and fair decision servicing. The successful-terminal-after-exit regression
also passes. Canonical `b816ebe8` passed (204 core and 198 Tauri checks plus
the existing frontend/storage/build gates). Independent retry review `449e69c8`
closed both findings with no new findings.

## Approval UI evidence

Red `65afbacc` reproduced missing permission controls and no-op decision/recheck
actions. Green `882c5fd8` passed 91 permission/controller/existing-view checks.
Red `874b960c` then reproduced unavailable complete-argument inspection and
misleading startup progress while approval was pending. Green `8280b0cc`
passed all 94 focused checks, frontend type/lint/color/contrast checks, and
Chromium interactions at 1280 and 390 pixels for all three provider fixtures.

The actual component was bundled with repository styles and deterministic
callbacks, not a native app or authenticated connector. Browser checks verified
no horizontal overflow, bounded preview/full-argument scrolling, keyboard
approval, cancellation during a pending callback, and explicit status recheck
without sending a message. No browser exceptions were observed. Screenshots
were inspected at `/tmp/opencode/qa-scribe-chat-preview-dist/`:
`permission-claude_code-1280.png`, `permission-complete-arguments-390.png`,
and `permission-recovery.png`, with additional per-provider widths retained.

Controller decisions carry only active job/Session/provider/request identity
and approve/deny. A separate decision operation leaves cancellation available;
late polling cannot reopen resolved tokens. Failed responses recheck canonical
status before allowing a new explicit click, never automatically resubmit.
Provider and response recheck is connected to the existing readiness refresh.
Reusable grants are not stored. F4 passed independent review at revision 76.

F4 review `auth-ui.R57-01` identified unreachable recovery after an uncertain
decision and failed immediate status lookup. Controller-to-view red `787518c7`
reproduced disabled recovery for all three providers. Status-only recheck is
now available while a response waits, without resubmitting a decision.
Additional red `4a90ab11` reproduced a cancelled job's unresolved invoke
blocking a new job's explicit decision. Terminal/job replacement now releases
the old local operation; its late response cannot overwrite the new job.
Green `7c33522e` passed 98 focused checks and frontend checks. Native pending
restoration still requires canonical status and a new explicit user choice.

Second F4 review found the same recovery route could disappear when composer
edits or autosave cleared the general error message. User authorized one more
repair attempt. Red `e4dffad9` reproduced six failures (edited/autosaved drafts
across all three providers), while the three untouched-draft cases passed.
Recovery availability is now derived from the job-scoped unresolved permission
ledger and projected separately through snapshot, hook and view. Composer
errors may clear without clearing that state. Green `fd95543d` passed 104
focused checks and frontend type/lint/color/contrast checks. Canonical recheck
and a fresh explicit choice remain necessary; no decision is repeated by edits.
Canonical `dcdd5813` passed without changing tests after an isolated legacy
ETXTBSY failure, and independent review `f94f28f0` closed R57-01 with no new
findings. Next: built-app/native provider evidence, then release preparation.

## Built-app and authenticated provider evidence

Native red `551eb78e` reproduced the stale Codex exec-only Chat fixture;
`36c0dd1c` then reproduced its obsolete argv assertion after native turn support.
Generation exec, transcript replay, rich handoff, cancellation and deletion
coverage remain intact. A registered standalone Chat wrapper and three native
authorization workflows extend the default runner to nine isolated invocations.
Framework-event execution JSON now rejects empty/skipped runs, including the
initial zero-exit helper-only observation `79001f26` (not behavior proof).
Node red `1df828b8` and subsequent green checks cover that contract.

Full native `71611837` exposed new test selector/selection mistakes. Fixed
native form event commitment and exact Session title selection, preserving
all persistence assertions. Green `107515aa` passed the standalone Chat workflow
and all fifteen authorization cases: approve, deny, cancel, policy denial and
explicit retry for Claude, Codex and Copilot. These are deterministic native
process fixtures, not authenticated Copilot execution.

The reproducible opt-in live harness is now in the repository:

```bash
TMPDIR=/tmp/opencode xvfb-run -a node scripts/run-chat-authorization-live.mjs --armed
```

It builds the actual candidate app, uses existing authenticated CLIs through
temporary wrappers, and configures only a harmless local marker server for
verification. No saved provider settings or credentials are copied/edited.
Independent nonce/call journals distinguish actual tool execution from model
claims. Initial live checks stopped before model calls on optional version
snapshot metadata. Version provenance now comes from the real executable's
bounded `--version` command. Red `94a46103` reproduced symlink-shim invocation
name loss; resolving for validation while retaining the invocation alias fixed it.

Live green `3b6427fa` passed all six native cases with Claude Code 2.1.300 and
Codex CLI 0.162.1 on Linux, candidate app version 0.8.1 from fresh build metadata.
Each provider approved exactly one marker call, denied/cancelled with zero calls,
and preserved the canonical transcript after WebView reload and Session reopen.
Evidence: `artifacts/chat-authorization-live/1792012316562-73ed2de7/evidence.json`.
The harness and marker fixture replace ephemeral helpers for candidate proof
(`auth-compatibility.R10-01`). Authenticated Copilot stays deferred; Jira is
unexercised because no issue key was supplied. Hosted macOS proof is required
before publication in release preparation.

F5 final focused validation `fa125f4e` passed 37 Node checks and nine native
invocations containing 23 tests, with zero skipped. Canonical `bc1383f3` passed.
Independent review `review:fab4754e-096d-4ec9-a1fc-73805974a796` accepted F5 at
revision 94, including the six actual Claude/Codex live cases `3b6427fa` above.
Retain the nonblocking F5 advisories: `R93-01`, native policy coverage proves
tool suppression, not classification (separate process tests prove
classification); `R93-02`, the Claude fixture lacks a negative correlation case.
Authenticated Copilot remains deferred, Jira remains unverified without an issue
key, and unverified hosted macOS coverage is required before publication.

## Release preparation checkpoint

F6 is active. Re-read this plan before the version step. Prepare 0.8.2 only
through the existing `bun run bump` script, first with `--dry-run`. Its expected
TODO changelog verification failure must be resolved with actual release notes
before the metadata check. Version preparation does not complete F6's independent
review, canonical checks, protected CI or release PR requirements, and does not
authorize F7 publication.

- [x] Record accepted F5 review, focused/canonical/live evidence and retained advisories.
- [x] Re-read this plan and run `bun run bump 0.8.2 --dry-run`, then `bun run bump 0.8.2`; record observed version facts and expected TODO verification failure.
- [x] Replace the generated TODO with concise release notes covering shared approval/deny/cancel/recheck, native Claude/Codex/Copilot Chat support, single-use pending decisions, persistence and live-validation limitations.
- [x] Run `node scripts/check-release-metadata.mjs --expected-tag v0.8.2` and `git diff --check`; record actual outputs.

On 2026-10-14, the manager observed `bun run bump 0.8.2 --dry-run` report
0.8.1 -> 0.8.2 across all seven release targets. The manager then ran
`bun run bump 0.8.2`, which updated those targets and failed as expected at
`scripts/check-release-metadata.mjs:143` because the generated changelog still
contained `- TODO: describe this release.` This was the expected placeholder
verification failure, not a successful metadata check. After re-reading this
plan, the placeholder was replaced with actual concise release notes under
`v0.8.2 - 2026-10-14`.

Manager validation `5ac79071` passed at revision 96 with the exact command:

```text
node scripts/check-release-metadata.mjs --expected-tag v0.8.2 && git diff --check && node scripts/check-workflows.mjs
```

Observed output: `Release metadata ok for v0.8.2 (qa-scribe)`; actionlint 1.7.12
installed release build, go1.26.1, linux/amd64. The command exited 0 with no diff
errors. F6 overall remains unchecked: canonical validation, release PR and
hosted CI are still pending. Hosted macOS coverage remains required before
publication; F7 remains unchecked.
