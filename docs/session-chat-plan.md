# Session Chat delivery plan

Approved outcome: optional persistent information-gathering Chat mode, explicit submission into the editable Session Note, existing Testware actions, and v0.8.0 publication through protected CI.

- [x] Phase 1: Persist Session chat drafts, execute bounded streamed CLI turns, and transactionally submit once into the existing rich Note. Verify lifecycle, persistence, provider commands, cancellation and submission tests plus `bun run verify`.
- [x] Phase 2: Add accessible Write note / Chat modes, durable composer, retry/cancel and explicit Note handoff. Verify UI/controller behavior and `bun run verify`.
- [x] Phase 3: Exercise multi-turn Chat, recovery, cancel/retry, Note preservation and explicit Testware generation in the isolated built app with `bun run e2e` and `bun run verify`.
- [ ] Phase 4: Bump to v0.8.0, write release notes, validate metadata/workflows and broad gate, merge the release PR after protected CI success, and verify automatic tag and published assets.

## Decisions and research

- The app-owned SQLite transcript is canonical. Replay bounded completed turns with the latest user message; do not depend on provider-specific resume files. Persist composer and turn state, and reconcile interrupted turns without automatic billing retries.
- Submit a faithful role-labelled transcript, escaped as rich-document content, appending to the primary Note. Keep rich HTML/JSON consistent and make repeated submission idempotent. Submission does not call AI or generate Testware.
- One active conversation per Session. Preserve submitted history and start a new conversation explicitly. Text-only chat in this delivery.
- Reuse existing provider readiness, model selection, neutral working directory, streaming parser, timeout and process-group cancellation. Use chat-specific restrictive CLI flags verified against primary documentation/help.
- Use `bun run verify` as the documented canonical Linux repository gate and `bun run e2e` for actual built-app behavior.
- The new capability uses v0.8.0. Follow `docs/releasing.md`: release branch, coordinated bump script, reviewed PR, protected CI success, authorized merge, automatic exact-merge tag, actual Release run and non-draft asset verification.

Exa research run: `agent_run_f5bcac2e45454e4b9f903ec0b57e9203` (completed). Its stateless replay recommendation fits the existing Rust-owned SQLite and CLI-only architecture. Store-plugin and file-based note suggestions do not fit this project and are not adopted.

Primary references:

- Claude sessions: https://code.claude.com/docs/en/sessions
- Claude CLI: https://code.claude.com/docs/en/cli
- Ref-read headless documentation (stdin and streaming): https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
- Codex noninteractive mode: https://developers.openai.com/codex/noninteractive.md
- Copilot tool permissions: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools
- Copilot programmatic stdin: https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically

## Verification record

Independent Flow review follows accepted current-source evidence.

- Backend red checkpoints: storage missing API (exit 101), eight prompt/command placeholder failures, then retry/atomic lifecycle missing API (exit 101).
- Initial broad gate stopped at expired Rust advisory reviews. Flow amendment `chat-audit-prerequisite` authorizes evidence-backed registry/document repair. Raw audit on 2026-10-14 still reports ten prior advisories; inverse Linux trees confirm exposures. Update dry run reveals available fixes and 192 proposed package changes. Registry now explicitly records available-but-unvalidated upgrade paths and a short 2026-11-14 deadline, preserving the lockfile and audit logic.
- Next broad gate stopped at two expired operational code-size exclusions. Amendment `chat-size-prerequisite` records reinspection of the existing 569/549-line packaging CLIs, retained until 2026-11-14 with unchanged threshold and scope.
- Frontend gate then passed 316 tests but caught two TipTap deferred-destruction errors after JSDOM teardown. Amendment `chat-editor-test-prerequisite` awaits the existing 1ms destruction callback after cleanup without changing production behavior or omitting tests.
- First backend broad gate passed (capture `551baea1`). Independent review identified `chat-backend.R20-01` (response/replay bound mismatch), `chat-backend.R20-02` (unbounded failed history), and `chat-backend.R20-03` (submission of unresolved turns). Nine new core boundary tests were observed failing before repair. Durable limits now include all statuses, enforce 16KiB messages and 128KiB/128-message drafts, and reserve an assistant slot on send. Submission requires completed messages and empty composer. Focused verification passed 33 storage tests and 13 shell lifecycle tests (capture `a75f436f`).
- Backend retry broad gate `126b50c2` passed; independent review `546af99d` passed and verified all three blockers repaired. Advisory `chat-backend.R26-01` concerns recovery wording for an earlier failed turn; Chat UI will explain when only an explicit new conversation is supported.
- UI red checkpoint `69d4d2a2` observed 44 failing view/controller cases before implementation. Frontend check and all 365 tests passed (`2b0cddfb`). Built desktop observation `45dcd53a` exercised mode selection, empty/active/cancelled states, retained cancelled user text and disabled unresolved submission at 1280/640 x 860 in light/dark themes. Screenshots in `artifacts/chat-ui` were inspected; mode-selection emphasis and tighter Chat layout were identified for correction before final validation.
- Corrected native rerun `36f388fe` passed. Inspected full-window dark and narrow light handoff screenshots: selected mode is visibly marked, controls fit without horizontal overflow, and handoff remains reachable through the common document scroll area. Full multi-turn Note/Testware proof remains Phase 3.
- UI independent review identified `chat-ui.R37-01` (stale Note after committed submit/reload failure), `chat-ui.R37-02` (deleted dirty Chat queue), and two presentation advisories. Regression checkpoint `27865c3a` observed 16 failing cases. Retry introduces a separate pending-canonical-Note guard covering edits and all Note write boundaries, read-only recovery UI, canonical read/adoption without duplicate submit, successful-deletion retirement with late-callback suppression, truthful dirty status and completed-output deduplication. Full frontend checks and all 389 tests passed (`ddd65e5f`), including ambiguous submit, rich-content recovery, deletion/in-flight-save and native-close cases.
- User authorized another UI repair after review found overlapping active-Session recovery (`chat-ui.R37-01`) and uncertain-outcome presentation (`chat-ui.R46-01`). Two regression cases failed before repair (`047d2ca6`). Active-Session recovery now waits for the handoff operation, and canonical adoption requires the same write version and a still-pending recovery guard. Unknown submission outcomes expose recovery-only controls and disable composer editing. Frontend check and all 391 tests passed (`d801e9d5`).
- UI review `95e7b9b6` passed with all five prior UI findings verified fixed. Current-source native visual check `6e2f3baf` and canonical gate `f77c009d` passed. Phase 3 now adds explicit multi-turn fixture behavior and Chat-to-Note-to-Testware proof to the built-app gate.
- Phase 3 initial `bun run e2e` passed (`fdcd2143`): six tests across five isolated native workflow invocations. The added Session-lifecycle test proves two completed Chat turns, cancellation/retry with identical user-message identity and exact replay, Session switching and WebView reload, preserved bold/list Note nodes, exactly-once role-labelled submission, subsequent edit persistence, and explicit generated Testware sourced from the saved Note. Submission starts no provider invocation. Inspected `artifacts/e2e/critical-workflows/session-lifecycle/chat-completed.png` and `chat-submitted-note.png`; long text wraps and handoff/Note controls remain reachable.
- Phase 3 final current-source native `58f3561c` and canonical `520de931` passed; independent review `64bee30f` passed with no findings. Release baseline is protected main `3ba0a223c502c2a9aadf7f69d8b8b1b83fdd5d6a`, confirmed equal to fetched origin/main.
