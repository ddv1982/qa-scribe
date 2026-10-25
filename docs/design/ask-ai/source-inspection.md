# Record the source inspection for the Ask AI plan

The parent and one read-only how investigator inspected source at `1c34f3e229ccf471241f7dfc7248b4d73c2ce6d9` on 24 October 2026.
This is source evidence only. Neither investigator ran application tests or real Jira operations.

The investigator ran on Codex `gpt-6.1-sol`, reasoning high, service tier priority.
Its T3 task ID is `node:delegated-task:command%3Amcp%3A1c38b82a-3691-42b7-a230-8604c1613f21%3Adelegate-task%3Aask-ai-phased-plan-how-20261024-1`.
The generic role received the portable Poteto prompt. It shared the checkout read-only and changed no files.

The parent checked these findings directly.

- `crates/qa-scribe-core/src/domain/chat.rs` has Session and chat draft identity but no record target.
- `src-tauri/src/commands/chat/preparation.rs` reads Session Context and bounded history, not a selected record snapshot.
- `crates/qa-scribe-core/src/chat/mod.rs` permits configured tools and explicit requests. Its persona remains a QA interviewer and prohibits automatic artifact generation.
- `crates/qa-scribe-core/src/ai/chat_protocol.rs` exposes Send, Update, Permission, and Complete. It has no structured question or Jira result event.
- `src-tauri/src/commands/ai/chat_duplex.rs` returns assistant text without a normalized Jira issue result.
- `crates/qa-scribe-core/src/ai/chat_protocol/codex.rs` rejects unsupported server requests and accepts only the existing restricted permission schema.
- `crates/qa-scribe-core/src/services/session_service/findings.rs` and `drafts.rs` both update in a transaction with no expected-base precondition. Both paths are in R1.
- `src-tauri/src/commands/chat/transport.rs` explicitly rejects Copilot image attachments while retaining input.
- `frontend/src/views/SessionChatView.tsx` owns the reusable image composer, transcript scroll, model controls, permission UI, and handoff.

- `CONTEXT.md` uses Testware as an umbrella term. The planned target is TestCasesDraft, mapped to stored `DraftKind::Testware`.
- Existing `copyRecordForJira` exports copy-ready text and does not create a remote issue. The new chat object is named JiraActionDraft to keep it distinct.
- The provider cwd is deliberately neutral. Jira image upload needs a separately qualified staged-file path.

The report suggested Markdown as the smallest Jira implementation. The parent retained the selected clickable design and added the structured interaction work explicitly to J1.
The parent separated Jira drafting from execution so unverified result handling cannot be presented as complete creation.

No AGENTS.md was found in the checked ancestor paths or project file inventory.
The plan checker validates document structure only. Prototype screenshots validate synthetic browser layout only.
