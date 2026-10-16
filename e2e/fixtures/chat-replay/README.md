# Synthetic Chat replay corpus

These nine version-1 JSON transcripts describe duplex Chat exchanges without provider binaries, accounts, credentials, or network access.
The `cli_version` value `synthetic` does not assert support for a released CLI version.
Authenticated CLI compatibility requires separate live evidence.

## Schema and readers

Each transcript contains the provider, wire protocol, scenario, constructor inputs, initial outbound frame, ordered steps, and expected `finish` result.
The `process` flag selects transcripts that also run through the real stdio fixture.

The steps describe three operations.

- `receive` delivers a provider frame. `events` lists every expected public event in order, or `error` contains the exact failure text.
- `decide` submits an approval choice and compares the complete outbound `reply`, including opaque IDs and option values.
- `next_permission` publishes the next queued permission without consuming its reply. `permission` is the complete expected detail or `null`.

Event objects contain one of `send`, `permission`, `delta`, `snapshot`, `progress`, or `complete`.
JSON objects compare by value. Event arrays compare in order. Unknown optional provider fields remain in the input frames.
Every step has a `release` trace label. These labels are not synchronization gates.

The [core reader](../../../crates/qa-scribe-core/src/ai/chat_protocol/tests/replay.rs) exercises the public `ChatProtocol` methods and compares every event and final result.
Its negative control changes an expected permission option and requires the comparator to reject the transcript.
The [Python reader](../../../src-tauri/src/commands/ai/chat_duplex/replay.py) runs inside the existing process fixture.
It sends the same provider frames and checks every outbound frame against `send` events and decision replies.
The [process test](../../../src-tauri/src/commands/ai/chat_duplex/tests/replay.rs) also compares the ordered text updates and terminal output.

The readers replace only whole string values equal to `$APP_VERSION` or `$CWD`.
`$APP_VERSION` becomes the workspace package version.
`$CWD` becomes `/work` in core tests and the actual child working directory in process tests.
The process reader accepts filesystem aliases only for `params.cwd` designated by `$CWD` in `thread/start` and `session/new` expectations.
Both paths must exist as directories and identify the same filesystem entry.
Literal paths, all other fields, and all other frames retain exact comparison.
The process suite verifies a symlink alias and rejects a distinct existing directory and an unrelated field change.
There is no general template language.

## Scenario inventory

| Transcript | Readers | Behavior |
| --- | --- | --- |
| `claude-queued.json` | Core and process | Initialization, queued mixed opaque IDs, approval then denial, partial text, authoritative final text. |
| `codex-queued.json` | Core and process | Early thread and turn notifications, text before the turn response, queued approval and denial, final snapshot. |
| `copilot-queued.json` | Core and process | Early commands metadata, Session creation, queued approval and denial with exact option IDs, terminal snapshot. |
| `claude-malformed.json` | Core | Malformed required assistant content and sticky failure. |
| `claude-unsupported.json` | Core | Unsupported control request and sticky failure. |
| `codex-foreign.json` | Core | Foreign thread rejection and sticky failure. |
| `codex-unsupported.json` | Core | Unsupported command approval request and sticky failure. |
| `copilot-foreign.json` | Core | Foreign Session rejection and sticky failure. |
| `copilot-unsupported.json` | Core | Unsupported server request and sticky failure. |

## Existing coverage outside this corpus

Core `handshake.rs` covers launch policy and model selection.
Core `permissions.rs` covers FIFO, queue bounds, stale IDs, one-sided options, and established Copilot metadata.
Core `compatibility.rs` covers unsupported elicitation forms, early metadata, and provider-specific compatibility details.
Core `lifecycle.rs` covers initialization failures, cancellation, duplicates, authoritative snapshots, and diagnostic isolation.
All four modules live in `crates/qa-scribe-core/src/ai/chat_protocol/tests/`.

The existing duplex `tests.rs` covers approval, denial, cancellation, policy failures, and one-sided Copilot decisions.
Duplex `tests/regressions.rs` covers output bounds, foreign metadata, successive permissions, provider cancellation, and cleanup.
Duplex `tests/lifecycle.rs` owns actual process synchronization markers and covers queued cancellation, deletion, watchdogs, parent exit, and inherited pipes.
Duplex `tests/bulk.rs` covers attempt-scoped approval and authority revocation.
These modules use the existing `src-tauri/src/commands/ai/chat_duplex/fixture.py` modes.

## Protocol scope

These transcripts describe duplex Chat, not model catalogs or one-way generation.
Copilot catalog discovery uses server protocol 3. Copilot Chat uses ACP protocol 1.
Their compatibility evidence is separate.
The [provider catalog contract](../../../docs/provider-catalog-contract.md) records catalog transport choices and compatibility requirements.
