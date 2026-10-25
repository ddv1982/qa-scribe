# Saved Proposal recovery independent review

**Verdict PASS+NOTES for the exact supplied source and core-test overlay.** No concrete open P0, P1, or P2 was found. An editor retaining Proposal origin can save unchanged canonical A after public Chat submission or restart. A pinned A still conflicts with changed B or C. This verdict does not approve the whole AskAI feature, native behavior, CI, integration, or release.

## Scope and independence

I am the fresh OpenAI review agent, running as gpt-6.1-sol with high reasoning effort. I did not implement the production patch or supplied tests. I mechanically applied the supplied tracked patch and copied the two exact supplied test files for candidate preparation. I made no semantic application edits or fixes. No nested or sibling agent was spawned. There is no fictional second reviewer.

The assigned isolated worktree is `/Users/vriesd/.t3/worktrees/qa-scribe/t3-bbd2d749`. It began clean at `37f1e434d829bad97dfe67d910e34242e44412d3`. Its Git HEAD remains that base. The tested candidate is an **uncommitted overlay**, not an exact committed candidate head. Parent root and other worktrees were not mutated.

I read the complete supplied Poteto skill, inline Principles index, runtime contract, Investigation playbook, how, unslop, technical-writing, applicable principle leaves, no-comments, and its portable Comment Sicko prompt. The user's explicit fresh-role and no-nested-agent instructions override those skills' default fan-out. Cross-turn sticky activation was unverified. Throughput checkpoint is n/a for this bounded investigation.

The supplied investigation, synthesis, and prior lease review informed the questions. Their reports and the author's 71-test count were not accepted as execution proof. I inspected the actual source and independently executed the services. The supplied GitHub comment URL was not fetched.

## Exact artifact receipt

Before applying anything, `/tmp/ask-ai-saved-proposal-review-verify.py` checked the base production bytes and base Git blob, all **23** manifest artifact hashes, all three owned source hashes, byte counts, and Git blob IDs. Every check passed. After preparation, `git diff` was byte-identical to the supplied production patch and the two test files were byte-identical to their supplied source paths. The final check repeated all artifact and candidate hash checks.

- Base HEAD `37f1e434d829bad97dfe67d910e34242e44412d3`.
- Base `chat_refinements.rs` Git blob `6b871630e12fec633c9a51028f07786fb2a1e17e`.
- Base `chat_refinements.rs` SHA-256 `ceb34b68eeee8b08ce2f59bbdef226ac25ab757aab1034baaf7546486ad9ca4d`.
- Supplied manifest SHA-256 `edc8281e02c2a1db43758a8144ad46fa5cb4e9e400dda830b6946ce9bb6cd4f3`.
- Supplied and independently retained production patch SHA-256 `2ed4e5ad0e6bdc76b7861a783180020c92a617013654f0d0ca7b4278d6e19def`.
- Independently retained full overlay SHA-256 `ce8d0318428b5fe99c265cd611be7cf356bf04dfe935addcedd8bb1481403505`.

Candidate source SHA-256 values follow.

- `crates/qa-scribe-core/src/services/session_service/chat_refinements.rs`, 10,242 bytes and 217 lines. `6014cca74d3510f619112b63d4f52c46c4d1fadcdda6c7ee752831b777595403`.
- `crates/qa-scribe-core/tests/saved_proposal_recovery.rs`, 19,060 bytes and 458 lines. `6271e34916eb787e759bd08c101c27aa1b3d4056192456037422fb123ba09550`.
- `crates/qa-scribe-core/tests/saved_proposal_recovery/support.rs`, 11,869 bytes and 324 lines. `6179ff1d92e8a4038479d8fb75fc813406b7c925f52c31b1eec4e9ea781810d5`.

The retained production diff is `/tmp/ask-ai-saved-proposal-review-overlay.patch`. The full production-plus-tests diff is `/tmp/ask-ai-saved-proposal-review-full-overlay.patch`. Machine-readable receipts are `/tmp/ask-ai-saved-proposal-review-hashes.json` and `/tmp/ask-ai-saved-proposal-review-final.json`. The production diff is exactly 17 added and 5 removed lines. Only the one production path is tracked-modified, and only the two supplied test paths are untracked outside ignored artifacts.

Thirteen supporting source files were separately byte-compared against the exact base, including both record update services, record bases, Chat domain/storage/submission, and frontend guard, persistence, and lease coordination. Their hashes are in `/tmp/ask-ai-saved-proposal-review-supporting-sources.json`. The private exact-base snapshot's 164 core files also match the base blobs.

## Source judgment

The relevant data shape is the pair of `RecordWriteOrigin` and durable `RefinementState`. Saved history does not replace the current record precondition or the frontend guard object's publication lease.

Both public record update services acquire `BEGIN IMMEDIATE`. `record_bases::matches` validates record Session ownership and calculates the current content hash before calling `guard_stage`. A stale expected base returns Conflict before the exception can execute. No remote row is automatically adopted as overwrite permission.

`guard_stage` resolves the requested stage through its relational proposal and owning Chat row. It checks target table, record ID, snapshot Session, owning Chat Session, and the Saved state's embedded stage ID. Only Proposal origin plus that exact Saved state bypasses Chat editability. A missing stage, malformed proposal, mismatched identity, or another state fails closed with a matching current hash. Staged keeps its original stage-time base condition. Stage-associated Compensation still checks Chat editability for Saved, Reverted, and restored-base replay.

`settle_stage` decodes the current proposal again and returns immediately for the same exact Saved Proposal stage. That path executes no UPDATE, Chat revision bump, transcript append, Note change, receipt change, or stage transition. All other settlement paths retain their earlier editability and state handling. Both record updates and settlement share the transaction, so a settlement error rolls back the record write.

All production callers of `settle_stage` are in the two reviewed record update methods. They run stage validation first, including the Compensation replay branch. SQLite's immediate write transaction prevents another public state writer from changing the stage between guard and settlement. No frontend map, lease object, fresh-stage base pin, catch ownership check, or ABA guard was changed. I read those callers and their prior protection contract, but did not rerun frontend controller tests in this core-only review.

## Independent executions

All Cargo commands used `CARGO_TARGET_DIR=/tmp/ask-ai-saved-proposal-independent-target` and `--offline`. The target directory is an ordinary `cp -R` copy of `/tmp/ask-ai-saved-proposal-target`, not a shared target or hardlink. The source and private `.cargo-lock` inodes were 242882923 and 242905286. Cargo writes went only to the private target. No dependency installation or network request was made.

The main candidate command was:

```sh
CARGO_TARGET_DIR=/tmp/ask-ai-saved-proposal-independent-target cargo test --offline -p qa-scribe-core --test saved_proposal_recovery --test record_write_guards --test chat_refinement --test chat_storage --test chat_context -- --nocapture
```

It exited 0 with **71 tests passed**. Suite counts were 8 recovery, 5 record guards, 4 refinement, 47 Chat storage, and 7 Chat context. The raw log is `/tmp/ask-ai-saved-proposal-review-core.log`.

These executions cover actual public submit and restart for both record kinds, repeated identical-A recovery, stale A against B and C, Editor continuation, current-hash Saved follow-up, content ABA, wrong record/table/Session with correct current hashes, missing stage, embedded Saved ID mismatch, owning Chat Session mismatch, non-Saved states, read-only Staged, Compensation restrictions including replay, ordinary patch validation, and existing transaction rollback.

I also wrote eight private tests in `frontend/artifacts/saved-proposal-review/probes/tests/review.rs`. Their fixture helper is an exact private copy of the supplied support file. The ignored standalone test crate depends on the actual core library. Its registry dependency versions and checksums match the repository Cargo.lock. No test double replaces a service, database, or hash implementation.

The exact-base command was:

```sh
CARGO_TARGET_DIR=/tmp/ask-ai-saved-proposal-independent-target cargo test --offline --locked --manifest-path frontend/artifacts/saved-proposal-review/probes-base/Cargo.toml --test review recovery_ -- --nocapture
```

It exited 101 with **four expected failures**, all `Validation("Proposal conversation is read-only")`. Each independent test covers one of Finding submit, Finding restart, test-cases Draft submit, and test-cases Draft restart. Four adversarial tests were filtered out. The snapshot contains exact base production source, not a reverse-edited candidate. The raw log is `/tmp/ask-ai-saved-proposal-review-base-red.log`.

The overlay probe command was:

```sh
CARGO_TARGET_DIR=/tmp/ask-ai-saved-proposal-independent-target cargo test --offline --locked --manifest-path frontend/artifacts/saved-proposal-review/probes/Cargo.toml --test review -- --nocapture
```

It exited 0 with **eight tests passed**, containing 24 explicit kind/state combinations. The raw log is `/tmp/ask-ai-saved-proposal-review-probes.log`.

1. Four recovery tests use actual public submit/restart, then save literal `Independent retained L`. They assert exact HTML, parsed rich-document text and image attributes, `tiptap_json`, metadata, and record kind. A repeated stale A cannot replace L. A confirmed Editor guard saves literal `Independent next M`. History remains byte-equivalent. Write-abort triggers cover all five supplied history tables plus Chat contexts, response contracts/messages, answers, and composer/message image association tables. Successful recovery proves the path issues no writes to any of those tables, including no same-value UPDATE.
2. Ten malformed-data combinations remove the Saved stage or before value, insert null or a non-string stage ID, or break proposal JSON. With synthetic read-only state and a correct record hash, every attempt errors and preserves literal A and all history. Synthetic database setup is deliberate. No normal public path was claimed to create corruption.
3. Six combinations perform actual public stage-associated Compensation, verify durable Reverted, and attempt the retained Proposal write while editable, submitted, or archived. None revives Saved. Literal A and history survive, and an ordinary Editor follow-up remains saveable.
4. Two record-trigger probes change Saved to Undone after record UPDATE but before settlement. Both return `Proposal stage changed before Save`, and the transaction rolls back both the attempted title and trigger mutation. This is a deliberate settlement fault probe, not a claim that production contains such triggers.
5. Two file-backed competing-connection probes hold an immediate state transition transaction. A second service update with zero busy timeout receives DatabaseBusy. After the first transaction commits Reverted, a retry observes that state and rejects the Proposal write, preserving literal A. This proves exclusion and state observation. It is not a timing-frequency, native, or performance claim.

Initial standalone-probe setup generated a fresh offline lock that selected newer cached transitive versions. Its four expected base failures are retained in `/tmp/ask-ai-saved-proposal-review-base-red-initial-lock.log`. I replaced that private lock with the repository lock and repeated the base run. The final base and overlay crates retain matching registry dependency versions and checksums. The copied helper emits one harmless dead-code warning for its unused `replace_proposal` method in the private probe crate. No suppression was added. The actual candidate's warnings-denied Clippy passed.

Additional checks all exited 0.

- `node scripts/check-code-size.mjs`. `/tmp/ask-ai-saved-proposal-review-size.log` reports zero failures and 135 files in the existing watch range. All three scoped files are at most 500 lines. No exception or policy file was added or changed.
- `cargo fmt -p qa-scribe-core -- --check`. `/tmp/ask-ai-saved-proposal-review-fmt.log`.
- `CARGO_TARGET_DIR=/tmp/ask-ai-saved-proposal-independent-target cargo clippy --offline -p qa-scribe-core --lib --test saved_proposal_recovery --test record_write_guards --test chat_refinement -- -D warnings`. `/tmp/ask-ai-saved-proposal-review-clippy.log`.
- `git diff --check`, exact path checks, all candidate hashes, patch identity, and repeated manifest artifact hash checks. `/tmp/ask-ai-saved-proposal-review-final-check.py` and its `.log`.

## Independent no-comments audit

I performed the fresh Comment Sicko review directly, as explicitly requested. No nested independent lane was claimed. I inspected all three complete scoped files and the actual patch. A string-aware scan excludes the two attachment-URL string literals before counting Rust comment delimiters. A separate scan checks lint and correctness suppressions.

The actual counts are **zero comments and zero suppressions across all three files**. The private probe source also contains no comments or suppressions. Touched application files for comment cleanup 0. Deletions 0. Restored comments 0. MUST KILL flags 0. Rejected reports or reruns 0. Architect sketches, fixes, encoding offers, encodings, and unenforced constraints 0. Unrelated baseline comments are outside this explicitly bounded scope. No comments-related open work remains.

The rerunnable audit is `/tmp/ask-ai-saved-proposal-review-comments.py`. Its receipt is `/tmp/ask-ai-saved-proposal-review-comments.json`.

## Notes, limits, and handoff

The chosen behavior deliberately allows a Saved Proposal with a fresh correct current hash to perform an ordinary record edit after Chat becomes read-only. Saved history remains unchanged, just as Editor-origin edits already can. It is not a new proof that the written content equals the original proposal's after value.

Changed B and later C remain Conflict against pinned A. Content ABA follows existing fingerprint equality, not a monotonic revision. An ordinary identical record UPDATE may still change `updated_at`. Stage-associated Compensation remains read-only after submission or archival, including replay. The original ambiguous-save feedback and the need for explicit conflict review remain unchanged.

Image checks prove rich-document and HTML reference preservation. They do not prove managed image file lifecycle or native rendering. Public restart here means conversation restart/archive, not a native application restart. No native/Tauri build, launch, performance measurement, real model, Jira, credentials, external action, staging, commit, push, PR post, or CI run occurred. This result cannot substitute for frontend/native acceptance or the parent's combined candidate.

The principles changed concrete choices. Model the Domain separated durable Saved history from current write authority. Boundary Discipline drove correct-current-hash identity probes inside the real service boundary. Make Operations Idempotent required abort-on-write triggers rather than only comparing history values. Test Behavior, Not Implementation drove literal body, metadata, image, future-Save, and stale-attempt assertions. Prove It Works required independent exact-base failures and candidate executions. Build the Lever produced retained hash, overlay, audit, and probe artifacts. The how and writing skills shaped this bounded explanation and verdict.

**The review read/test fence is released.** No further source edits or test processes are planned by this reviewer. This release applies only to this isolated review checkout. It does not release the layout owner's source/build fence. Parent integration must still wait for that separate fence, then verify and accept the fresh combined candidate and native build. Parent owns all Git, external, integration, CI, and release effects.
