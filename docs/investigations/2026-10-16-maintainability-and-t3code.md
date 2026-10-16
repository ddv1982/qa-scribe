# Maintainability and CLI integration investigation

Investigated on 2026-10-16. QA Scribe commit `321f73ba993fc9f461152244ae6c7238c12fbefa`. T3 Code commit `e3b35d1b2440b104f0bc2e357377c348121234dd`.
The local QA Scribe checkout also contains pre-existing edits to eight plan documents. This investigation does not modify them.
This report explains the findings. The [execution plan](../maintainability-program-plan.md) contains the proposed work.

## The useful comparison is ownership, not feature count

QA Scribe already uses structured CLI protocols, bounded subprocess execution, explicit permission replies, catalog fixtures, and native application tests.
T3 Code provides useful examples of provider contracts and deterministic protocol replay. Copying its runtime architecture would import obligations that a local testing notepad does not need.
Keep Rust, Tauri, React, SQLite, optional AI, editable generated content, and explicit tool permission choices.
The next improvement is to make state ownership easier to trace while preserving the safety behavior already implemented.

## A provider turn crosses three existing boundaries

Generation starts with readiness and selection validation in `src-tauri/src/commands/ai/provider_execution.rs`.
Non-interactive generation uses `streaming_exec.rs`. Interactive Chat uses `chat_duplex.rs`.
Core `ChatProtocol` converts provider frames into outbound messages, text updates, permission requests, and completion.
The Tauri executor owns pipes, process groups, watchdogs, cancellation, permission cleanup, and forwarding to `JobStore`.
The frontend consumes job events and recovers status when its event channel disappears.

These boundaries have different jobs. A common event type does not justify combining every executor.
Catalog discovery does not submit a prompt. Chat can execute tools and requires an interactive permission lifecycle.
Copilot catalog discovery uses server protocol 3. Copilot Chat uses ACP protocol 1.
Their request sets, authentication observations, and failure conditions must stay distinct.
See [the existing provider catalog contract](../provider-catalog-contract.md).

## T3 Code patterns that earn further investigation

| Pattern | Evidence in T3 Code | QA Scribe decision |
| --- | --- | --- |
| Separate a driver definition from a configured instance | [ProviderDriver and ProviderInstance](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/packages/provider-core/src/server/driver.ts) | Adapt the ownership rule. Keep the fixed provider enum until multiple configured instances are an actual product requirement. |
| Keep provider orchestration behind a common contract | [ProviderAdapter](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/packages/provider-core/src/server/ProviderAdapter.ts) | Retain the existing `ChatProtocolEvent` boundary. Improve the state behind it before adding another interface. |
| Replay inbound frames and assert outbound frames | [Replay transcript decoder](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/packages/provider-testing/src/replayTranscript.ts) | Add versioned, sanitized replay fixtures to the existing test infrastructure. Assert exact permission replies and completion semantics. |
| Pause replay at named synchronization points | [Replay gates](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/packages/provider-testing/src/replayGate.ts) | Replace timing assumptions in selected race tests with explicit reached and release signals. Keep this test-only. |
| Represent configuration and capabilities explicitly | [Driver contract](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/packages/provider-core/src/server/driver.ts) | Use only facts needed by existing controls. Unknown capability evidence must remain distinguishable from false. |
| Use scoped runtime resources | [Adapter infrastructure](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/apps/server/src/provider/ProviderOrchestrationAdapterInfrastructure.ts) | Borrow the ownership rule. Preserve Rust process-group cleanup and bounded queues. An Effect or JavaScript migration is not justified. |

T3 Code's public code is a reference implementation, not proof that every provider works on QA Scribe's platforms.
Its much wider provider and orchestration scope changes the cost-benefit calculation.
No T3 application, provider session, or authenticated provider was launched for this comparison.
If implementation copies source rather than ideas, retain the [MIT attribution](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/LICENSE).

## The protocol state shape is the first structural target

`crates/qa-scribe-core/src/ai/chat_protocol.rs` stores `provider`, numeric `stage`, optional `scope`, optional `turn`, pending replies, tool metadata, and completion flags in one object.
The provider modules interpret these shared fields differently.
For example, Copilot's stages track initialization, Session creation, and prompting. Codex also correlates a thread and turn across notifications and replies.
Claude uses a different control protocol.

This is a reader-load problem, not evidence that the current tests are failing.
A maintainer must remember both the provider and the meaning of a numeric stage before changing a transition.
An outer enum containing `ClaudeProtocol`, `CodexProtocol`, and `CopilotProtocol` would let each implementation own its legal states.
A provider-specific phase enum can carry the identifiers required by that phase.
Keep opaque permission identifiers and provider reply payloads behind the adapter.
Do not convert every wire payload to a large hand-maintained schema.
Parse the fields that establish identity, transition legality, and permission authority at the boundary.

Migrate one provider and its callers at a time. Preserve the public normalized events.
Use replay output to compare the old and new implementation during the migration, then remove the old path in the same PR.
Do not retain a permanent dual implementation.

## Runtime duplication needs a narrower decision

`streaming_exec.rs` and `chat_duplex.rs` both spawn children and drain pipes.
They also implement different completion rules.
Duplex Chat can finish on a protocol terminal event while the server remains alive.
The one-way stream executor has its own EOF, writer, and watchdog rules.
`chat_duplex.rs` already bounds channels, revokes permission authority, registers the child before I/O, and reaps descendants on exit.

Keep these safeguards. A shared spawn helper is useful only if it removes duplicated resource ownership and preserves both completion contracts.
The plan does not require a universal process framework or a long-lived provider daemon. Runtime extraction is a separately scoped follow-up, not part of the error-classification PR.
Characterize cancellation before spawn, blocked writes, inherited pipes, malformed frames, and success followed by a live peer before attempting extraction.
A result that finds no safe simplification is acceptable.

## Provider errors need a small contract, not another catalog framework

Catalog DTOs already distinguish provider status, evidence confidence, source, warnings, and discovery failures in `src-tauri/src/commands/providers/types.rs`.
Generation and Chat still return many free-form strings.
A narrow protocol error enum can distinguish invalid frame, unsupported request, provider failure, and incomplete stream. Keep process timeout, cancellation, and unavailable executables in the existing runtime boundary.
Keep sanitized detail for diagnosis and map categories to user actions at the UI boundary.
Preserve the current persisted error contract unless a separate migration is justified.
Do not promise provider-neutral recovery when a provider supplies insufficient evidence.

Capabilities must state their scope. A model catalog capability is not proof that the active Chat transport supports a permission form.
The existing provider-managed Default and custom model choices must survive discovery failures.
Avoid expanding provider settings into a generic plugin marketplace or account manager.

## Frontend state ownership is at least as important

The earlier capability refactor and native E2E program already exist. Repeating them would produce little value.
See [the current roadmap](../refactoring-roadmap.md) and [quality scenarios](../quality-scenarios.md).

Recovered generation polling in `frontend/src/app/generationActions.ts` uses an untracked asynchronous loop.
Chat polling in `sessionChat.polling.ts` already has duplicate suppression, stop, and dispose operations.
`useSessionChat.ts` disposes that polling on unmount.
This inconsistency warrants unmount, repeated-reconciliation, and late-result characterization tests.
It does not establish a reproduced user-visible leak.

`LatestNoteGenerationUndo` in `frontend/src/app/types.ts` mixes normal undo with recovery choices through optional fields.
A local discriminated union can make the recovery decision explicit.
Summary recovery and Chat uncertain-commit recovery have different semantics. Preserve both.
They can share a small capability that answers whether a Session Note may be written or hydrated.

`useAppController.navigation.ts` understands write versions, saved refs, serialized bodies, compensation, and attachment mutations.
`usePendingChangeProtection.ts` reconstructs related pending-state policy.
A Session settlement snapshot can give navigation and close protection the same answer without exposing Note serialization.
Keep compensation until tests prove another mechanism handles the same stale-write cases.

`useStableCapability.ts` publishes context through an effect and a Proxy.
The controller also uses provisional success callbacks to break wiring cycles.
First characterize actions before publication and across a context change.
Remove the dependency cycle before replacing the mechanism.
A global store or another layer of forwarding hooks does not solve that cycle.

## Rendering and portability remain separate product decisions

Rich editor JSON, generated Markdown, sanitized HTML, and clipboard HTML have distinct consumers.
Chat disables remote images. Testware can resolve managed Evidence through a native attachment command.
Do not collapse those trust rules merely to use one renderer.
Rendering consolidation should follow a corpus that checks semantic output, attachment references, clipboard behavior, and unsafe content.
This investigation does not justify replacing the editor or rendering libraries.

The read-only command and README inventory did not reveal a portable workspace backup and restore workflow.
That is an important follow-up for a local-first product. This pass did not design a backup format or validate a full database and attachment restore.
Treat backup and retrieval as product discovery after the first maintainability changes, rather than adding them to the protocol refactor.
Observe testers completing capture, evidence selection, generation, editing, and retrieval before choosing additional features.
Record completion, confusion, lost context, and recovery behavior. Do not infer product value from test count.

## Verification distinguishes evidence from inference

Fresh parent-run core protocol checks passed all 32 selected tests with `cargo test -p qa-scribe-core ai::chat_protocol -- --nocapture`.
An independent read-only frontend lane passed seven files and 46 tests covering Chat recovery, Summary close protection, compensation, settlement, hydration races, Markdown, and Testware preview.
The precise command is in the plan's Appendix D.
The parent-run focused Tauri duplex suite passed 29 selected tests with `cargo test -p qa-scribe-tauri commands::ai::chat_duplex -- --nocapture`. These tests exercise local fake processes, queues, permission replies, bounds, and cleanup. They do not launch authenticated CLIs.
No native desktop E2E, authenticated-provider matrix, T3 test suite, or performance baseline was run for this research.
No runtime equivalence or speedup is claimed.

## Principles changed specific choices

- Subtract Before You Add keeps the existing stack and removes duplicate ownership before adding abstractions.
- Minimize Reader Load makes legal transitions and state authority the target instead of controller line count.
- Model the Domain selects provider phase enums and a recovery union instead of more synchronized flags.
- Sequence Work into Verifiable Units puts replay before protocol changes and separates polling, recovery, and settlement.
- Prove It Works keeps native execution and authenticated compatibility as future gates, not conclusions from static review.
- Encode Lessons in Structure makes the replay corpus and plan checker repeatable checks rather than additional prose rules.

## Research coverage and limits

The parent inspected provider execution, the core protocol, native test configuration, startup gates, existing plans, and T3 driver and replay code.
One read-only Poteto delegate compared providers. One read-only explorer traced frontend ownership.
All shared checkout access was read-only. Only the parent wrote these documents and the local audit trail.
The delegates inherited `gpt-6.1-sol`. No different-family review is claimed.
The public reference is the pinned GitHub repository. The T3 Code application running this conversation may contain different changes.

## Provider-specific reference points

Codex uses a [typed app-server client](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/packages/effect-codex-app-server/src/client.ts). QA Scribe can validate the subset of request and response fields it consumes without adopting the entire generated client.

Claude uses an [Agent SDK query adapter](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts) and a [provider probe](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/apps/server/src/provider/ClaudeProvider.ts). These are useful contract examples. They do not establish that adding a Node sidecar is worthwhile for QA Scribe.

Copilot is recognized through the [ACP registry adapter](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/packages/provider-acp-registry/src/server/adapter.ts). Its [Copilot-specific event routing](https://github.com/pingdotgg/t3code/blob/e3b35d1b2440b104f0bc2e357377c348121234dd/packages/provider-acp-registry/src/server/copilotAcp.ts) demonstrates that generic ACP does not remove every provider-specific concern.

## Independent review receipt

An independent inherited-model auditor checked the code pointers and plan. The audit identified an untestable native-only React timing claim, a runtime extraction mixed into the error PR, and a stale frontend build risk in the proposed performance probe. The plan now pairs internal timing receipts with native user workflows, defers extraction, and requires a production frontend build at each measured revision.

A separate read-only comment audit found no comments or suppressions to remove from the new documents. Neither audit claims a different model family or live provider verification.
