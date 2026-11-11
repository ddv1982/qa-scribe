# Resolve the Ask AI plan review

This records corrections to the original plan before implementation. The later user clarification and [implementation decisions](implementation.md) supersede the proposed Jira integration, qualification gates, and separate JiraActionDraft object. The selected [generic chat replies](jira-chat-replies.md) retain the visual follow-ups with the existing coding agent.

One independent review ran on Grok `grok-4.7`, reasoning high. The parent used Codex `gpt-6.1-sol`, reasoning high.
The reviewer was read-only. The parent inspected and edited the plan and design evidence. This is a response to that review, not a second approval.
The complete local review summary is `/tmp/qa-scribe-ask-ai-plan-20261024/review-summary.md`.

All seven mandatory findings were accepted.

1. Refresh the plan checker receipt after all document corrections. The final receipt belongs to the current file.
2. Save the independent review summary and link it from Appendix E.
3. Move built-app E2E invocations out of unit verification. Name exact macOS and Linux commands with the selected spec under every live block.
4. Name `bun run bindings:generate` before binding checks where contracts change.
5. Include `update_finding` and `update_draft`, both Tauri commands, both frontend action modules, and both persistence modules in R1.
6. Use TestCasesDraft for the stored test-case target. Support Jira drafting from both Findings and Test cases. Name the new chat object JiraActionDraft and preserve the existing Jira Bug Draft and clipboard-only Copy behavior.
7. Make all ten J1 and J2 core live lanes deterministic native-app fixture scenarios. Keep armed real Jira qualification separate. Require a real capability receipt before enabling that connector feature and at least one real creation qualification before declaring Jira actions delivered.

The external-action corrections name the correlation mechanism and its limits. The reviewed payload can carry an operation-specific label only when metadata and the connector support it. Search requires an exact label, project, type, and parent match. A missing or ambiguous match remains OutcomeUnknown. Connections without correlation search do not promise automatic recovery.
Selected Jira evidence uploads require checked, operation-owned staged copies and an upload-capable connector. The provider cwd remains neutral. Chat image support does not establish Jira upload support.

The optional findings were also accepted.

- Use the explicit IPv4 preview URL.
- Disclose that the retained historical receipt lists captures outside the three durable current screenshots. Link the synthetic evidence image.
- Mark the final Create screenshot as J2 end state, not J1 behavior.
- List Finding subtask first with a Recommended label without preselection when several valid types exist. Select it automatically only when it is the sole type.

The parent also added readable proposal, question, answer, and result entries to conversation export and Note handoff. Handoff does not apply proposals or repeat actions.
The parent removed all nine reported CSS narration comments from the copied prototype. No application code changed. No MUST KILL symbol or suppression was reported.

The independent review's child-session sticky-hook limitation does not change the parent's trusted sticky receipt.
Its statement about no second family applies to the absence of nested review. This task had one independent Grok review of the Codex-authored plan and no second review of the corrections.
The remaining proof requirements are native behavior, actual provider contract support, configured Jira metadata, and armed real creation and upload qualification. They are planned work, not completed evidence.
