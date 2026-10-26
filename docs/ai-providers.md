# AI providers and Session Chat

[Back to the README](../README.md).

## Set up one provider

Complete [a first testing task](getting-started.md) without AI before you configure a provider. Ordinary Create finding and Create test cases need no account.

Install one CLI using its provider's maintained instructions. Sign in outside QA Scribe.

- **Claude Code.** Follow the [installation guide](https://code.claude.com/docs/en/overview). Check `claude --version`, run `claude auth login`, then check `claude auth status --json`. See the [CLI authentication commands](https://code.claude.com/docs/en/cli-reference).
- **Codex CLI.** Follow the [official OpenAI installation guide](https://learn.chatgpt.com/docs/codex/cli). Check `codex --version`, run `codex login`, then check `codex login status`. See the [login reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli#codex-login).
- **GitHub Copilot CLI.** Follow the [installation and authentication guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli). Check `copilot version`, start `copilot`, and enter `/login` when prompted. QA Scribe may also direct you to `copilot login` when authentication is required. Plain `gh copilot` help alone does not establish readiness.

Open **Settings** and choose **Refresh CLI configuration** after installation or sign-in. Check the provider status, then select a provider and model for the next request. Restart QA Scribe if a new CLI is not available in the desktop app's executable search path.

Installed means the CLI executable responds. Authenticated means the CLI has accepted local credentials. Ready means QA Scribe's current checks passed. Readiness does not guarantee account entitlement, quota, network availability, or success with a selected model.

Choose **Generate with AI** inside a new Finding or test-case draft, choose **Summarize with AI** on Note, or send a Chat message to request AI. Review the context before generation. A status refresh checks configuration and can run CLI probes, but does not request generated output. Opening Help or the synthetic example does not refresh providers.

## Create with optional AI

Choose **Create finding** or **Create test cases** from Note or the corresponding collection. Both open the same local, unsaved creation flow with shared starter sections. You can write and Save without a provider.

**Prefill from note** uses the reviewed saved Note's plain text, without formatting or screenshots. Findings use only its first 4,000 characters. It fills the current draft rather than creating another record; confirm before replacing authored text.

**Generate with AI** reviews the saved source Note, including its revision, and the selected provider and output choices. Successful generation saves one result immediately and opens it for review. If the draft already has authored work, confirmation is **Generate and replace draft**: success closes the local draft and discards its unsaved text and local images. Cancellation or failure keeps that draft. A changed Note must be reviewed again before it can be used as the source.

## Providers

AI generation is optional. Capture, persistence, manual review, Draft editing, and attachment handling work without AI configuration.

QA Scribe does not manage API keys. It checks local CLI readiness and only starts generation when the user explicitly chooses a ready provider and runs generation.

- Claude Code: checks `claude --version` and `claude auth status --json`, detects model aliases from `claude --help`, then runs `claude -p` with the prompt on stdin. When a non-default model is selected, qa-scribe passes `--model <model>`. AI action jobs use `--output-format stream-json --include-partial-messages` so the UI can show progress and partial output.
- Codex CLI: checks `codex --version` and `codex login status`, detects selectable models from `codex debug models`, then runs `codex exec --skip-git-repo-check -`. When a non-default model is selected, qa-scribe passes `--model <model>`. AI action jobs use `--json` so the UI can show progress and partial output.
- GitHub Copilot CLI: checks the real `copilot version` command. If the standalone CLI is not present, qa-scribe only treats `gh copilot` as ready when `gh copilot -- --help` confirms the Copilot CLI bridge is installed. Plain `gh copilot --help` does not mark Copilot ready.

Provider status can be ready, auth required, install required, or error. Provider model and reasoning choices are recorded on each AI Run, included in the provider prompt, and passed to provider CLIs where supported. Provider authentication remains the responsibility of the local CLI.

## Session Chat

Create or open a Session, then select **Ask AI** beside the Note. The conversation opens in the same panel style as Ask AI for Findings and test cases; the Note stays editable alongside it in a wide window. Close the panel to return to the Note in a narrow window. Notes keeps its own conversation, separate from record conversations. Chat uses the same detected, authenticated local provider and model selection as existing Note actions. Send messages explicitly, exchange testing details, and choose **Add conversation to note** when every turn is complete and the composer is empty.

Submission appends the role-labelled conversation to the primary Note, preserves its existing rich content, and closes the Ask AI panel. You can edit it, choose **Create test cases** or **Create finding** and then **Generate with AI** inside the draft, or use **Summarize with AI**. Submission itself makes no AI request.

Expand **Conversation options** for model selection, provider setup, usage details, or **Start new conversation**. Closing and reopening Notes Ask AI retains its current messages, unsent text, and images.

Paste a screenshot into **Message** with Ctrl+V or Cmd+V, or use the paperclip beside **Send** to choose images. Click a thumbnail to inspect it. Remove an image before sending with its remove button. You can send an image without text. Enter inserts a new line. Ctrl+Enter or Cmd+Enter sends the message.

Messages, images, unsent composer content, and mode are stored locally per Session. Completed turns and their images are replayed to the CLI on each request. Sending images transmits their pixels to the selected provider. Provider-native resume files are not required. Cancelled, failed, or interrupted latest turns can be retried explicitly without duplicating the user message. An earlier unresolved turn requires a new conversation. Starting one archives the old conversation locally. Adding the conversation to Note preserves its screenshots.

Chat text is bounded to 16 KiB per sent message, 128 KiB of transcript text, and 128 messages including unsuccessful turns. Each message accepts up to four images, 10 MiB per image and 20 MiB in total. Provider and replay limits can be lower. Use PNG, JPEG, WebP, or GIF. Image support also depends on the selected provider and model. Unsupported inputs produce an error instead of silently dropping images.

Image sends require confirmed model image support. QA Scribe uses catalog capabilities and documented Claude identities when the SDK omits that field. Copilot Chat image sends are currently unavailable. Choose a compatible provider or start a new text-only conversation. A rejected image send keeps the composer intact.

For turns that include images, QA Scribe omits raw provider errors and stderr to keep image data out of diagnostics. Setup and input-validation errors remain specific.

If submission succeeds but its response or Note reload fails, the Note is write-protected until **Recover Session Note** safely reads its canonical state. Authentication remains in the existing CLIs. QA Scribe does not add direct provider APIs or store API keys.

Chat can use tools and connectors already configured in Claude Code, Codex CLI, or GitHub Copilot CLI, subject to that provider's permissions. For example, a configured Jira connector can retrieve a user story on request. Native permission requests appear in Chat with **Approve once** and **Deny** actions; **Cancel response** remains available. Decisions apply only to the requested invocation and are not saved as reusable permissions. Existing CLI deny rules and managed policies remain authoritative. QA Scribe adds no tool allowlist, MCP override, or permission bypass. User-scoped CLI configuration is inherited in neutral execution directories; project-local configuration is not loaded from the app's launch directory. Authentication and connector setup remain CLI-owned. Tool access does not automatically submit or modify the Session Note.

Chat uses Claude's bidirectional stream-json control protocol, Codex app-server stdio, and Copilot's ACP stdio interface. Unsupported permission request schemas fail visibly rather than being auto-approved. Where a provider supplies only a description, Chat labels it as a provider description instead of inventing a tool identity. **Recheck status** reloads response and provider readiness without sending a message; **Retry response** is an explicit new attempt. Authenticated Copilot tool execution has not been verified for this change because account access is unavailable; its approval transport is covered by deterministic process and UI checks.

Claude and Codex Chat use a fresh temporary directory each turn. Copilot Chat uses the stable private `copilot-chat` directory inside qa-scribe's Tauri app-data directory, because Copilot saves approvals by directory. After the first Copilot Chat attempt creates it, open an interactive Copilot CLI there and approve the specific tools you want to use. Those approvals remain CLI-owned and apply to later Chat turns. On Linux the default scope is `~/.local/share/io.github.ddv1982.qa-scribe/copilot-chat` (or the equivalent under `$XDG_DATA_HOME`); on macOS it is `~/Library/Application Support/io.github.ddv1982.qa-scribe/copilot-chat`. This directory persists across turns and app restarts; files created there by permitted tools also remain. Ordinary generation and readiness probes continue using fresh temporary directories.

## Ask AI from a Finding or test case

Select a saved Finding or test case and choose **Ask AI** beside Copy and Edit. Manual and generated records use the same chat engine in a separate conversation for that record. Clicking Ask AI while it is open focuses the current Message. Closing and reopening a settled panel starts a fresh conversation; unfinished work remains recoverable from its original conversation.

Sending includes the record's current content, including unsaved edits, without saving it. Notes chat has its own messages, input, images, and tool decisions. Record conversations cannot be added to the Session Note.

Paste or choose screenshots in **Message** using the existing image controls. Attach a screenshot to Message to ask about it, even if it already appears in the record. Updating a record preserves its existing screenshots. They are not automatically sent as chat images or uploaded to Jira.

Describe an improvement and choose **Send**. The reply shows suggested title, content, and finding-field changes. **Update finding** or **Update test case** saves the reviewed change in one action and confirms completion. Ordinary questions and tool requests continue as chat without requiring an edit.

If the saved record changed, request a fresh suggestion. Newer edits made while Update is in progress remain in the editor. Retrying the same proposal after a failed response is safe: an already completed update is read back rather than written again. Legacy Notes suggestions retain their existing Apply, Save, and Undo controls.

Record context is limited to 32 KiB per snapshot and 128 KiB across a conversation. An oversized request retains Message and the record edits. Shorten the record or start a fresh conversation as the error directs.

## Draft Jira work in chat

Ask the coding agent to draft Jira content from the selected record. Review the content, then answer its missing-detail questions. Follow-ups can cover a new issue or subtask, project or parent, configured issue type, and required fields. For Findings, request the exact configured type **Finding subtask**. For Test cases, choose the type you want.

When the agent offers reply choices, click one with an empty composer or type your own answer. A choice sends its visible text. Pending text and images remain intact when a direct choice cannot send. Old choices become inactive once the conversation moves on or their original record is no longer selected.

Preparing an action request fills an editable Message. Review it and choose Send to ask your configured agent to act. Its Jira access and tool permissions remain CLI-owned. Chat shows the agent's reported result and links. Copy on the record remains a clipboard action.
