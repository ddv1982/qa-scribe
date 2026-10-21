# AI providers and Session Chat

[Back to the README](../README.md).

## Providers

AI generation is optional. Capture, persistence, manual review, Draft editing, and attachment handling work without AI configuration.

QA Scribe does not manage API keys. It checks local CLI readiness and only starts generation when the user explicitly chooses a ready provider and runs generation.

- Claude Code: checks `claude --version` and `claude auth status --json`, detects model aliases from `claude --help`, then runs `claude -p` with the prompt on stdin. When a non-default model is selected, qa-scribe passes `--model <model>`. AI action jobs use `--output-format stream-json --include-partial-messages` so the UI can show progress and partial output.
- Codex CLI: checks `codex --version` and `codex login status`, detects selectable models from `codex debug models`, then runs `codex exec --skip-git-repo-check -`. When a non-default model is selected, qa-scribe passes `--model <model>`. AI action jobs use `--json` so the UI can show progress and partial output.
- GitHub Copilot CLI: checks the real `copilot version` command. If the standalone CLI is not present, qa-scribe only treats `gh copilot` as ready when `gh copilot -- --help` confirms the Copilot CLI bridge is installed. Plain `gh copilot --help` does not mark Copilot ready.

Provider status can be ready, auth required, install required, or error. Provider model and reasoning choices are recorded on each AI Run, included in the provider prompt, and passed to provider CLIs where supported. Provider authentication remains the responsibility of the local CLI.

## Session Chat

Create or open a Session, then choose **Write note** or **Chat**. Chat uses the same detected, authenticated local provider and model selection as existing Note actions. Send messages explicitly, exchange testing details, and choose **Submit to Session Note** when every turn is complete and the composer is empty.

Submission appends the role-labelled conversation to the primary Note, preserves its existing rich content, and returns to Write note. You can edit it and use **Generate test cases**, **Create finding**, or **Summarize notes** afterward. Submission itself makes no AI request.

Messages, unsent composer text, and mode are stored locally per Session. Completed turns are replayed to the CLI on each request; provider-native resume files are not required. Cancelled, failed, or interrupted latest turns can be retried explicitly without duplicating the user message. An earlier unresolved turn requires a new conversation; starting one archives the old conversation locally. Submitted conversations remain readable until you explicitly start another conversation.

Chat is text-only and bounded to 16 KiB per sent message, 128 KiB of transcript text, and 128 messages including unsuccessful turns. Oversized sends retain the unsent composer text. If submission succeeds but its response or Note reload fails, the Note is write-protected until **Recover Session Note** safely reads its canonical state. Authentication remains in the existing CLIs; QA Scribe does not add direct provider APIs or store API keys.

Chat can use tools and connectors already configured in Claude Code, Codex CLI, or GitHub Copilot CLI, subject to that provider's permissions. For example, a configured Jira connector can retrieve a user story on request. Native permission requests appear in Chat with **Approve once** and **Deny** actions; **Cancel response** remains available. Decisions apply only to the requested invocation and are not saved as reusable permissions. Existing CLI deny rules and managed policies remain authoritative. QA Scribe adds no tool allowlist, MCP override, or permission bypass. User-scoped CLI configuration is inherited in neutral execution directories; project-local configuration is not loaded from the app's launch directory. Authentication and connector setup remain CLI-owned. Tool access does not automatically submit or modify the Session Note.

Chat uses Claude's bidirectional stream-json control protocol, Codex app-server stdio, and Copilot's ACP stdio interface. Unsupported permission request schemas fail visibly rather than being auto-approved. Where a provider supplies only a description, Chat labels it as a provider description instead of inventing a tool identity. **Recheck status** reloads response and provider readiness without sending a message; **Retry response** is an explicit new attempt. Authenticated Copilot tool execution has not been verified for this change because account access is unavailable; its approval transport is covered by deterministic process and UI checks.

Claude and Codex Chat use a fresh temporary directory each turn. Copilot Chat uses the stable private `copilot-chat` directory inside qa-scribe's Tauri app-data directory, because Copilot saves approvals by directory. After the first Copilot Chat attempt creates it, open an interactive Copilot CLI there and approve the specific tools you want to use. Those approvals remain CLI-owned and apply to later Chat turns. On Linux the default scope is `~/.local/share/io.github.ddv1982.qa-scribe/copilot-chat` (or the equivalent under `$XDG_DATA_HOME`); on macOS it is `~/Library/Application Support/io.github.ddv1982.qa-scribe/copilot-chat`. This directory persists across turns and app restarts; files created there by permitted tools also remain. Ordinary generation and readiness probes continue using fresh temporary directories.
