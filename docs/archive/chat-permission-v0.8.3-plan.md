# Session Chat permission repair and v0.8.3

Scope: fix distinct concurrent permission requests, add explicit response-local
bulk approval, and prepare and publish the next stable release through the
documented process. Preserve unrelated documentation edits. Bulk approval never
changes saved provider policy and expires with the response/attempt.

- [x] Reproduce and repair bounded concurrent permission handling, verify correlation, duplicate/replay rejection and lifecycle cleanup, pass canonical checks and independent review.
- [x] Add Approve all for this response through backend and UI, verify queued/future requests and consent reset with focused and native checks, pass canonical checks and independent review.
- [x] Adopt the 23 intended paths against immutable 13203952fa631ed8b714cfc2f24baa6ad104ac51 in the replacement session, revalidate and independently accept the combined concurrency and bulk approval diff.
- [ ] Prepare scripted v0.8.3 metadata, verify candidate and hosted CI, independently review and push release PR.
- [ ] After separate merge authorization, verify exact automatic tag, actual release run, assets and signed live APT publication, then independently accept and archive.

## Evidence

Planning inspection: the core rejects every second pending request regardless of
distinct ID, and the duplex runner separately supports only one decision receiver.
This establishes a concurrency limitation, not the exact cause of the reported
Jira interaction. Latest origin/main: 13203952fa631ed8b714cfc2f24baa6ad104ac51.
Latest published release at planning: v0.8.2. Canonical gate: `bun run verify`.

### Concurrent permissions

RED `eaecc8b3-5549-4239-809e-a4be6f341f08`: real-child regression
`successive_then_burst_permissions` reproduced the exact error after two approvals
and a distinct request burst. GREEN focused `8532f04b-e94f-431b-b713-657242fbedcc`:
32 protocol tests and 18 real-child tests passed across three providers, including
FIFO mixed decisions, typed opaque IDs, duplicate/replay rejection, queued provider
cancellation and overflow. Capacity is 32 unresolved requests including the head.
The first broad check exposed two clippy style errors in the new test callbacks;
these were corrected without changing assertions or production behavior.

Review findings `concurrent-permissions.R8-01` and `concurrent-permissions.R8-02`
requested durable historical RED provenance and queued-handoff failure coverage.
The manager's Flow detail contains the original RED observation:
command `cargo test -p qa-scribe-tauri successive_then_burst_permissions -- --nocapture`,
exit code 101, complete output true, recorded revision 4, Linux,
source digest `sha256:c5ed7c13a33b94a5c2ecc4e04157b528743f478f816497aa2f87a882c912bee1`,
output digest `sha256:6e903aa58b93f34f0b0545ac7db4ff41ab1a2c108f09dc85446b4b8daf7392f6`.
The actual failure output was:
```
running 1 test
thread 'commands::ai::chat_duplex::tests::chat_duplex_process_successive_then_burst_permissions_fifo_all_providers' panicked at src-tauri/src/commands/ai/chat_duplex/tests/regressions.rs:306:39:
ClaudeCode/number: Duplicate, stale, or concurrent permission request
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 209 filtered out
error: test failed, to rerun pass `-p qa-scribe-tauri --bin qa-scribe-tauri`
```
This is retained historical evidence, not a current-source failure or live Jira
claim. The fixture reads and verifies two sequential approvals before emitting
the three distinct requests that triggered that failure. The retry adds explicit
queued cancellation/deletion handoff, invalid next-prompt metadata, watchdog and
parent-exit checks, with marker synchronization rather than guessed sleeps.

Accepted review `72b72a3b-7f62-4221-93ef-4ac2c5235d3d`, revision 14:
both prior findings fixed, no new findings. Focused queued checks passed
`925f7846-f9cb-4c26-a93c-5332d2ad7e9c`; canonical gate passed
`e7e54daa-dac2-4cc6-93c8-5432483c87a0` (212 Tauri tests, 3 pre-existing
ignored; 208 core, 98 storage, 465 frontend and 151 Node tests).

### Response-scoped bulk approval

The grant is a local boolean in one duplex execution, set only by the validated
`approveAll` decision received for the visible prompt. Queued and later supported
requests use their original once-only provider payloads and the same JobStore
metadata, cancellation, deletion and identity gates as a click. Reject-only
requests still need an explicit denial. No persisted policy or database changes.

Historical manager-owned RED observations (complete output, Linux):

* `d20253cc-e442-44d5-99b7-16fa73240b7a`, revision 16, command
  `bun run --cwd frontend test src/app/sessionChat.permissions.test.ts src/app/sessionChat.permissionRecovery.test.tsx src/views/SessionChatView.permissions.test.tsx`,
  exit 1: 13 failed, 84 passed, missing bulk button and rejected controller choice.
  Source `sha256:334dcd691f6f7e2009d2801e6a75341eafa0a63bf6fb6169275d662abdd10282`,
  output `sha256:f93e12d60790fb764a68bf8dfa10fc8d46d9a26093768c2800936ba6d9177679`.
* `d9960844-7cc3-4e9e-b1eb-f07ae5648218`, revision 17,
  `cargo test -p qa-scribe-tauri bulk_ -- --nocapture`, exit 101:
  two failures, unknown `approveAll` wire variant.
  Source `sha256:1c499cb1f7b19caad8a79577c48185ab9ad317fec6149a854914a51259443c78`,
  output `sha256:c03b1bbfcf8990b4b9b20e55c291759fe36f8211f76f0ab9142697e08e71e903`.
* After adding the wire variant and its guard but before implementing runner bulk
  behavior, `5a014ddb-6ee5-4114-a879-93bd3be830b0`, revision 18, same Rust
  command, exit 101: backend passed but real child rejected the actual denied
  reply where approval was expected.
  Source `sha256:7273438924d48b7aae9bd0c644a980400e320c8d9a27bc15ed39d71c34de37de`,
  output `sha256:08f903d93ed066dadffd796fe609d24d63b4ac1b6b53111fd2a20301b08c8c54`.

Focused GREEN `bbb87f73-5d37-4907-9062-5e01e4da6524`: two Rust bulk
checks, 97 UI/controller/recovery checks and 17 fixture tests passed. Additional
negative tests cover bulk cancellation/deletion, terminal state and Copilot
reject-only requests. Native run `38087d4d-1fec-4ff0-9c9f-e0f6e083b70f`
passed all nine invocations, 26 tests, zero skipped. The prior invocation was
interrupted by the host's 120-second command limit, not a test failure; rerun
allowed 600 seconds. Each provider's bulk scenario executes four actual marker
children after one click (three queued and one later), then requires fresh consent
in the same Session's next response. Existing once/deny/cancel/policy/retry and
reload/reopen persistence cases remain. These are deterministic provider fixtures,
not authenticated Copilot or a live EMP-990 Jira reproduction.

### Authorized ownership-baseline recovery

Original session `b84dfb10-e7da-48d1-a4a6-d2ebec3438f7` was archived as
deferred at revision 25 with explicit user authorization. Its bulk run had
captured accepted prior dirty concurrency files without declaring ownership.
Review preparation refused those edits; retries cannot replace immutable
baselines. No source or historical evidence was discarded or rewritten.

Replacement session `f46f4971-8978-44e7-9c44-7046be2208d1` combines the
concurrency and bulk repair into one feature. `flow_run_start` accepted an
explicit 23-path `existingWork` inventory against commit
`13203952fa631ed8b714cfc2f24baa6ad104ac51`, with baseline digest
`sha256:fe351f75390ac43684b385ffc41a8d57985d63af57752662e6edc1b2b774c11a`.
The three unrelated dirty documentation files remain excluded. Fresh validation
and complete integrated base-diff review are required; previous evidence above
is historical provenance, not substituted for fresh execution.

Integrated review `dc63a2aa-6607-4ca2-be39-a2fb64d261a0` passed with no
findings at replacement revision 8. Fresh focused validation
`96e18dcc-f4de-497f-9bf1-124423b76fbf`: 32 protocol, 26 real-child, 14 backend,
97 frontend and 17 fixture tests passed. Native validation
`6a46625a-4c1e-4fb4-8a16-11525cae5e47`: nine invocations, 26 tests, no skips.
Canonical `b3b2823a-c08b-4727-a770-352e6c523819` passed. Complete 23-path
immutable-base diff reviewed; historical findings verified fixed. R1/R2/R3/R4/R6
accepted for this feature; release preparation and publication remain pending.

### Release candidate

Integrated implementation committed as `5c9e6a4` on `release/v0.8.3` before
starting the release feature, avoiding dirty shared-path carryover. `origin/main`
remained `1320395`; latest published release remained v0.8.2 and no v0.8.3 tag
existed at version selection. `bun run bump 0.8.3 --dry-run` previewed all seven
canonical outputs, then `bun run bump 0.8.3` wrote them. Its expected metadata
failure named the generated changelog TODO, now replaced with scoped release
notes. No manual version edits, dependency updates or workflow changes.
