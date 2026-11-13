# Test cases fixtures

Saved Test cases drafts used as evidence for how a draft splits into test cases
(`../testCases.ts`). Each file holds `bodyHtml` and `document`, exactly as the app stores a
saved draft (`body` and `bodyJson`), plus the draft's `metadataJson`.

## `generated/`

Real model output on synthetic notes. Nothing here comes from a user's data.

- Source notes: three short notes written for this purpose (a checkout address form, login
  rate limiting, an invoice PDF export). Each fixture repeats its note in `sourceNote`.
- Produced on 2026-11-13 with ten calls: five to Claude Code (`claude -p --verbose
  --output-format stream-json --include-partial-messages`, default model, reported as
  `claude-opus-5-5`) and five to Codex CLI 0.167.2 (`codex exec --skip-git-repo-check --json -`,
  default model `gpt-6.1-sol` from the local Codex config, which the stream does not report).
- The path is the app's own: a throwaway program built on `qa-scribe-core` created an in-memory
  Session with the note, rendered the real `testware-v5` prompt with the chosen preferences
  (`prepare_ai_action_generation`), ran the CLI with the command line from
  `streaming_generation_command` in a fresh temporary directory, and passed the output through
  `finish_ai_action_generation` (response parser, sanitiser, saved Draft). The saved body then
  went through `richEditorDocumentFromStoredBody` and `richEditorDocumentToStoredBody`, as the
  frontend does when it opens and saves a generated draft.
- File names are `<format>-<provider>-<note>.json`. Technique and depth vary per file.

Do not edit these by hand. To refresh them, repeat the steps above and update the expected
titles in `../testCases.test.ts`.

## `manual/`

Hand-written drafts: each manual starter from `shared/creation-starters.json` filled in with a
little text, a QA cases draft made from the earlier starter (every section an h3, not migrated),
and an older draft saved before format metadata existed (`metadataJson` is null).
