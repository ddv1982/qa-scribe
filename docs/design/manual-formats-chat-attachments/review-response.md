# Reconcile the design review

The independent reviewer was `grok-4.7` with reasoning high. The parent checked the findings against source and the disposable prototype. Production code remains unchanged. These corrections respond to the review. They are not a second independent approval.

1. Image-only turns cross every text-only boundary. A1 now names ordered message parts, lifecycle preparation, protocol construction, every provider encoder, a schema version above 13, and a transactional table rebuild. It also covers submitted attachment immutability. The migration scenario must prove the changed schema and constraints, rather than merely reopen old data. Assistant responses remain text-only. That response instruction does not prohibit image input.
2. Clipboard and file limits count different things. A2 now names the existing 25 MiB RGBA cap and the separate encoded-file ceiling. The plan requires a bounded chat clipboard policy that handles a 3840 by 2160 screenshot. Native pixels become PNG before encoded and provider limits apply. No production limit changed during this design task.
3. Format metadata must not make an untouched starter authored. F1 now distinguishes body replacement from navigation settlement. Format metadata alone does not require a warning. Deliberate changes to Finding type, severity, status, or title still count as work to preserve. The review's broader proposal to ignore a non-bug type for all settlement was narrowed to avoid losing meaningful metadata. The prototype and plan now use the actual Finding type label.
4. The prototype reset edited messages. Native Chrome reproduced the defect with `Keep my edited message 4827.`. Removal restored the old sample sentence. The fix adds a message field to prototype state and assigns its value through the DOM on each render. A native retest preserved the exact distinct sentence and removed the image control. The saved observation is in `removal-native-receipt.json`. The old claim is explicitly superseded in the decision trail.
5. Matching format IDs does not prove matching structures. F1 now pins every starter to Rust output guidance and names the expected QA cases, checklist, Gherkin, charters, and coverage outline structures. It requires unsaved editor hints instead of the prototype's completed checkout examples. UI labels retain their current values. Prompt labels remain separate.
6. Green artifact checks do not prove a working feature. The plan now distinguishes schema assertions, deterministic transport receipts, and authenticated model qualification. A1 also has an operator review gate. `plan-check.txt` proves document structure only. `artifact-check.txt` proves catalog and image-file checks only.

The first seven decision rows were written as one retrospective batch at 06:28:15 UTC. They do not record individual action times. Later entries retain their actual write times. The original rows remain intact.

The review's note that every row shared one timestamp was too broad. The transport row was already timestamped 06:31:49 UTC. The underlying concern about the first batch was valid.

Saved narrow-layout PNGs and their actual render metadata now support the 728-pixel, 360-pixel, and clean-console observations. Earlier observations existed only in supported tool history.

No comments or suppressions were deleted. The independent review found none in its scoped artifacts. Exa and Ref research was performed by the parent in the original design task. The reviewer did not independently re-fetch those pages.
