# Session Chat CLI tools and v0.8.1

- [x] Restore CLI-configured tools and permission-respecting prompt, prove real child-process tool execution and multi-turn final answers with red/green checks, run `bun run verify`, and obtain independent review.
- [ ] Prepare v0.8.1 with the version bump script and accurate release notes, verify release metadata and `bun run verify`, and obtain independent review.
- [ ] Push the reviewed release PR, observe protected CI success, merge normally, and verify the automatic exact-merge tag, successful Release run, published assets and live APT version.

Keep the neutral provider cwd and normal CLI permissions. Existing user-scoped connectors are inherited; project-scoped configuration and interactive permission prompts require CLI-side setup. No Jira integration or permission bypass is added. Preserve the pre-existing edit in `docs/session-chat-plan.md`.

## Evidence

- Red checks reproduced the prompt prohibition, actual child-process tool suppression, loss of a shorter final tool-backed answer, and zero-exit structured errors treated as success.
- Focused green checks exercise Claude, Codex and Copilot production command builders through the real process executor, plus tool-turn final-answer replacement and structured permission failure.
- Claude Code 2.1.299 discovered the existing Atlassian resource tool from the neutral execution directory. Its normal permissions denied the call, and the assistant reported that limitation. A subsequent smoke with a process-local allow rule for only `mcp__claude_ai_Atlassian_MCP__getAccessibleAtlassianResources` invoked the tool successfully and returned `CONNECTOR_OK`. Saved configuration was unchanged; no issues or pages were queried. This demonstrates connector execution with permission, not automatic approval under the user's current policy. Authenticated Codex/Copilot connector execution is not claimed.
- The first canonical gate failed the 500-line policy. The recorded same-goal amendment moves tests into child modules without dropping coverage or changing the policy.
- Independent finding `chat-tools.R17-01` identified the same final-answer issue in Codex. New real-process and stored-conversation checks reproduced persistence of the preamble instead of `Connected.` before the fix. Completed Codex assistant snapshots now replace earlier preambles, while reasoning and tool events remain excluded.
- Current-source canonical `6ba5ad0a` passed: 391 frontend, 176 core, 98 storage and 171 Tauri tests, plus audit, metadata, formatting, lint, build and smoke checks. Independent review `e0c967fe` passed R1-R4 and closed `chat-tools.R17-01` with no new findings.
- Release candidate `0e0c5d8` passed local v0.8.1 metadata and canonical checks, but hosted CI run38557750697 failed Linux/macOS Chat workflows because the deterministic Codex fixture recognized only the old prompt and required removed tool restrictions. User authorized a bounded fixture compatibility repair. Canonical red `361cb53c` reproduced the wrong fixture response through a new executable regression bound to the current Rust prompt version. Amendment `repair-current-chat-fixture-contract` preserves workflow coverage and fixture isolation.
- Fixture regression green `dbcb9d91` passed all nine runner tests. Built-app Linux `112aa526` passed seven cases across five isolated workflows, including Chat replay, cancellation/retry, rich Note submission, Session deletion with real provider process termination, explicit Testware generation and Summary recovery.
