# Jira follow-ups in shared chat

## Intent

The user wants the existing coding-agent chat inside the designed Ask AI panel. Jira drafting asks for a new issue or subtask, project or parent, configured issue type, and missing required fields. Findings use the exact requested name Finding subtask. Test cases ask for the desired type. The user explicitly excludes real Jira testing and a separate integration. Keep the visual follow-up experience and ordinary typed replies.

## Candidate A

The earlier architecture sketch supports two app-owned destination replies, New issue and Subtask. Other details remain ordinary Markdown questions. This needs the smallest domain-specific choice type but does not provide clickable issue-type and required-field follow-ups from the visual design.

## Candidate B

Use one bounded completed-response question adjunct. Its prompt and choices are agent-reported text. A click sends the visible choice as an ordinary chat reply. It executes no app action, grants no tool permission, and contains no hidden value or command. Project and type knowledge remains with the configured coding agent. The app does not maintain or certify a Jira catalog.

The proposed model is `Question { prompt, choices: string[] }` inside the versioned response envelope. The app assigns identity from the completed assistant message. Limit the list to eight choices and each choice to 160 characters. Reject duplicate or blank choices and unknown fields. Render strings as text. The visible label is the complete reply payload. Links, commands, structured values, and callbacks cannot hide behind a choice.

The ordinary chat start transaction checks the owning conversation, latest unanswered question, selected choice, and expected chat revision before saving the readable user reply and answer correlation. Only one reply answers a question. The original message snapshot stays pinned. Retry reuses the same reply rather than inserting another answer. Old or submitted questions cannot send. A changed target must be visible and must not silently answer a question about another record.

An unambiguous typed reply can use the same correlation when the active record still matches the question. Other typed text remains ordinary conversation. No field reducer, draft table, metadata validator, provider-native question bridge, Jira client, or connector qualification system is added. Invalid response envelopes keep a readable fallback without buttons.

The drafting prompt requests content first and one missing detail at a time. The agent resolves actual configured types through its existing tools. It must not invent a type ID, silently replace Finding subtask, or create Jira configuration. Review and creation requests continue through editable chat and the existing tool permissions. An agent-reported link remains an agent report.

## Review questions

Compare both candidates against the user's full visual follow-up request, simple ownership, visible reply authority, stale-answer safety, and shared-chat flexibility. Identify concrete blocking gaps in B rather than treating displayed agent choices as a verified catalog or a direct tool call. Choose the smallest candidate that meets the intended experience.

## Selected contract

Codex and Grok independently recommend B. Adopt their concrete guards. Do not add a Jira catalog or field reducer.

- A direct choice send requires an empty composer, no images, no pending image work, and no image failures. Otherwise preserve all input and explain how to send a typed reply or clear the composer. Never overwrite an occupied composer or send its images with a choice.
- Only the last completed assistant message can offer active choices. Any subsequent user message expires them, including failed, cancelled, interrupted, and uncorrelated turns. Derive this from transcript order.
- The server correlates typed text only when its trimmed value equals exactly one choice. Do not use substring matching or case folding. Preserve the user's original message text. Other text stays ordinary conversation and still expires the old choices.
- Refuse direct choice sends and typed correlation when the active target kind and record ID differ from the question's original user-message target. Detach and Session context count as different targets. Explain the original target beside the inactive choices. Ordinary typed Send remains available with its current context; a word matching an old choice must not trap general chat.
- A correlated answer uses the question's original immutable snapshot. It does not recapture a different document. Existing owner and availability checks still apply. A fresh draft request can use a newer snapshot.
- Persist extracted readable Markdown as the assistant text and the validated question beside its assistant message. Allocate identities in the app. Render controls only from that stored adjunct, never by reparsing arbitrary prose. Note handoff and replay retain readable questions and answers.
- Render normalized choice text as its entire send payload. Reject blank, duplicate, multiline, and control-character labels. A Recommended badge is display-only and may accompany the exact Finding subtask choice for a Finding. It does not preselect a choice or alter the reply text.

The reviews are `/tmp/ask-ai-jira-replies-review-a.md` and `/tmp/ask-ai-jira-replies-review-b.md`. Both are source and design reviews. Runtime proof remains required after implementation. Their warnings are accepted as contract corrections. They do not establish a defect in code that has not been written.
