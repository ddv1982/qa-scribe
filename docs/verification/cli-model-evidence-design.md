# Model evidence and preference ownership

The implementation uses candidate B with the amendments below.
Two independent read-only candidates covered additive scalar columns and one typed JSON value.
An independent judge requested through `claudeAgent` with model `claude-sonnet-5-5` preferred the JSON design.
The serving model was not independently attested.
The parent read both full candidates, checked the affected source, and agrees with the base selection.

## Store one typed record per invocation

Expose `AiRun.modelSelection` as Legacy or Recorded. Recorded contains requested intent and an optional scoped provider report.
Keep Default, Copilot Automatic, and opaque explicit IDs distinct.
Non-Copilot `auto` remains an explicit ID at the execution boundary, preserving current command semantics.
The existing Settings migration can continue its historical normalization for those providers.

Add one nullable `ai_runs.model_selection_json` column through the existing schema migration owner.
NULL means that the old model string has legacy, ambiguous provenance.
New run insertion always writes Recorded JSON. Malformed non-NULL JSON is a stored-data error.
Keep the old physical model column for additive migration, but remove the ambiguous public `AiRun.model` API and migrate all consumers.
Update the startup fixture generator and every run insertion path in the same phase.

## Carry reports through the existing execution boundary

Encode metadata source and scope in one typed variant, including Claude initialization, Claude assistant-message metadata, and Codex thread configuration.
Never infer provider metadata from PlainText or assistant content.
Delete the fabricated Claude initialization stdout currently used by the Chat duplex adapter.
Capture Claude initialization only with the actual init envelope.
Prove any stream-event message-start source with literal protocol fixtures before accepting it.
Assistant-scoped Claude reports supersede initialization. Later initialization cannot replace an assistant-scoped report.

Retain typed reports through successful, failed, timed-out, and cancelled outcomes at the stream owner.
Keep the lower process executor's existing String error when its callback collector already owns the report.
Freeze collection at accepted cancellation. Never collect new evidence from trailing buffers after the cancellation boundary.
Record at most one report update before terminal settlement, using the prepared run ID and a running-state guard.
A missing report performs no write. Unknown evidence remains unknown.

## Keep one Settings writer

Keep `useSettingsController` as owner of saved settings, drafts, and persistence.
Add a semantic quick-model action rather than a second preference store.
Use a ref-held write guard shared with full Settings Save. Do not add a mutation queue or change full Save into a generic diff protocol.
Quick persistence builds from saved settings. Merge only untouched draft model keys after success and preserve unrelated edits and edits made while awaiting the command.
Keep the prior confirmed selection on failure. Show saving state and block a conflicting launch until persistence settles.
Capture provider, model, and effort at Send or Generate handler entry before the first await.
Preflight confirmation must launch the selection shown to the user or refresh its displayed summary before confirmation.

Expose previous-turn evidence through the existing run association without adding one frontend request per message.
Reuse ModelSelector in the next-action control and retain one global preference per provider.

## Rejected additions

Four nullable columns would duplicate the same invariant across SQL and Rust without a current model-query requirement.
A separate evidence table, provider framework, remote manifest, persistent-session controller, and frontend preference store add ownership beyond this feature.
A generic Settings mutation queue would change more Save semantics than the required busy guard.

## Required proof

Cover a real schema-10 migration, fresh run insertion, malformed evidence, forged plaintext metadata, wrong Claude system envelopes, report precedence, failed and cancelled runs, and stale report writes.
Cover dirty Settings drafts, pending writes, save failure, per-provider isolation, and launch capture across asynchronous Note or composer persistence.
The M01 red regressions also established that preserving Copilot Auto requires both argument handling and Settings normalization.
