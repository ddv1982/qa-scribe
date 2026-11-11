# Editor conversion layer: replace custom logic with libraries

**Date:** 2026-07-08
**Status:** Approved by Douwe (research + phased plan reviewed in session)

## Problem

The rich-text editor itself is TipTap 3.27.1, but ~724 lines of custom conversion
code surround it:

| File | Lines | Concern |
| --- | --- | --- |
| `frontend/src/editor/editorHtml.ts` | 278 | Hand-rolled allowlist HTML sanitizer + normalization helpers |
| `frontend/src/editor/editorDocument.ts` | 246 | TipTap JSON ↔ HTML bridge + JSON-level URL sanitization |
| `frontend/src/editor/clipboardExport.ts` | 200 | Custom HTML→Markdown walker for Jira copy-paste (plain text only) |

Hand-rolled sanitizers are the risky part: they don't receive security updates
when new browser parsing quirks (mXSS, namespace confusion) are discovered.
The markdown walker duplicates serialization logic TipTap now ships first-party.

## Goals

1. Move the security-critical HTML sanitization onto DOMPurify (Cure53-maintained).
2. Replace the hand-written HTML→Markdown walker with first-party `@tiptap/markdown`.
3. Add rich Jira paste: clipboard carries `text/html` alongside the plain-text
   markdown fallback, so pasting into Jira keeps formatting. (Approved change to
   the previous "plain text only, Jira owns theme colors" behavior.)
4. Behavior-preserving where not explicitly changed; existing tests stay green.

## Non-goals

- Switching editor frameworks (Lexical/Slate) — rejected in research; TipTap is
  the right base and is already in place.
- Rust-side sanitization changes (`crates/qa-scribe-core/src/generation/html.rs`)
  — out of scope; the single-sourced tag constants continue to feed both sides.
- Mentions / slash commands — separate feature decision.
- Jira ADF or direct Jira API integration.

## Design

### Invariants (must hold before and after)

- Allowed tags come from the Rust-exported bindings constants
  (`EDITOR_HTML_TAGS`, `SELF_CLOSING_EDITOR_HTML_TAGS`,
  `MANAGED_ATTACHMENT_PROTOCOL`) — the sanitizer and core's response-repair
  pass must not diverge.
- Link URLs: `http:`/`https:`/`mailto:` only; sanitized links get
  `target="_blank" rel="noreferrer"`.
- Image sources: managed-attachment protocol, `data:image/*`, or `http(s)`.
  Managed images are canonicalized to `src="qa-scribe-attachment://<id>"` +
  `data-attachment-id`.
- `input` only as `type="checkbox"` (+ optional `checked`); task lists keep
  `data-type="taskList"` / `data-type="taskItem"` + normalized
  `data-checked="true|false"`.
- Dual storage stays: `body` (sanitized HTML) + `bodyJson` (tiptap_json).
- JSON-level sanitization in `editorDocument.ts` stays — it guards the stored
  `bodyJson → editor.commands.setContent` path, which never passes through
  HTML parsing. (Phase 3 only removes what DOMPurify provably makes redundant.)
- Managed/data-URI images export to clipboard text as `Image: <alt>`, never as
  markdown image links.

### Phase 0 — Pin current behavior

Extend the existing test files (`editorHtml.test.ts`, `editorDocument.test.ts`,
`clipboardExport.test.ts`, ~637 lines total) with golden cases that are
currently untested but load-bearing for the swap:

- XSS vectors: `javascript:` hrefs, `onerror` attributes, nested/escaped
  `<script>`, mXSS-style markup (`<svg>`/`<math>` wrappers), DOM clobbering
  (`name`/`id` collisions), comment nodes.
- Unwrap-vs-remove semantics: unknown tags unwrap keeping content; the
  removed-tag list (`embed, form, iframe, math, meta, object, script, style,
  svg, template`) drops content entirely.
- Exact clipboard markdown output for a kitchen-sink document (headings, bold,
  italic, links incl. label==href, ordered/unordered/task lists, nested lists,
  managed + external + data images, line breaks).

### Phase 1 — DOMPurify replaces the sanitizer core

`sanitizeNoteHtml` keeps its signature; internals become:

1. `DOMPurify.sanitize(value, config)` with `RETURN_DOM: true`:
   - `ALLOWED_TAGS`: from `EDITOR_HTML_TAGS`.
   - `ALLOWED_ATTR`: union of per-tag attrs (`href`, `target`, `rel`, `src`,
     `alt`, `data-attachment-id`, `type`, `checked`, `data-type`,
     `data-checked`); `ALLOW_DATA_ATTR: false`, `ALLOW_ARIA_ATTR: false`.
   - `ALLOWED_URI_REGEXP` extended with the managed-attachment protocol.
   - `FORBID_CONTENTS`: the removed-tag list, so those drop content (matching
     current remove semantics) while other unknown tags unwrap via default
     `KEEP_CONTENT`.
2. A compact app-semantics post-pass over the returned DOM (not
   security-critical — DOMPurify has already removed dangerous markup):
   - links: enforce URL policy (`isSafeEditorLinkUrl`), add `target`/`rel`;
   - images: managed-attachment canonicalization, `isSafeEditorImageSource`;
   - inputs: checkbox-only, normalize `checked`;
   - `ul`/`li`: task-list attribute normalization;
   - strip attributes not in that element's per-tag allowlist (DOMPurify's
     `ALLOWED_ATTR` is global, so e.g. `href` on `<p>` is stripped here).

Everything else in `editorHtml.ts` (entity repair, empty-detection, filename
helpers, preview hydration) is untouched. Expected: ~140 lines of traversal
replaced by ~30 lines of config + ~50 lines of post-pass.

New dependency: `dompurify` (types included since v3).

### Phase 2 — `@tiptap/markdown` replaces the clipboard walker

- Add `@tiptap/markdown` at the workspace TipTap version (3.27.1); configure
  `markedOptions: { gfm: true }` in a serialization-only extension set (task
  lists → `- [ ]` / `- [x]`).
- `formatRecordForClipboard` converts `bodyHtml → RichEditorDocument`
  (existing `richEditorDocumentFromHtml`) and serializes JSON → markdown,
  instead of walking HTML.
- Custom markdown renderers where first-party output differs from the pinned
  format: ManagedImage (`Image: <alt>` for managed/data/unsafe sources,
  `![alt](url)` for external https), links where label == href (bare URL, no
  autolink brackets).
- Title stays a prepended `## <title>` line.
- Escaping delta: markdown serializers escape literal `*`/`_`/`#` in text.
  Decision: post-process to keep output paste-friendly ONLY if the pinned
  golden tests show regressions that would look wrong in Jira; otherwise
  accept the serializer's escaping as more correct.
- `managedAttachmentReferencesForClipboard` switches to walking the
  RichEditorDocument JSON for image nodes (no DOM needed).

### Phase 3 — Slim `editorDocument.ts`

With Phases 1–2 landed:

- Re-audit `sanitizeJsonRootDocument` and friends: keep URL policy on
  link marks and image nodes (independent XSS layer for stored `bodyJson`);
  delete only checks duplicated by schema constraints of the extension set.
- `richEditorDocumentToHtml` keeps its sanitize-on-output call (defense in
  depth is cheap here).
- Consolidate any now-dead helpers in `editorHtml.ts`/`htmlUtils.ts`.

### Phase 4 — Rich Jira paste (`text/html` + plain fallback)

- Feasibility spike first: `navigator.clipboard.write(ClipboardItem)` with
  `text/html` inside the Tauri WebView (WKWebView on macOS). If unsupported or
  flaky, use `@tauri-apps/plugin-clipboard-manager` `writeHtml(html, plainAlt)`
  (needs the Cargo plugin + capability permission + JS package).
- `ClipboardPayload` gains `html`; `copyRecordForJira` writes both
  representations; plain markdown remains the fallback and the
  degraded-clipboard path.
- HTML variant: title as `<h2>`, body = the already-sanitized editor HTML,
  with managed/data-URI images replaced by a text placeholder
  (`Image: <alt>`) — they cannot render outside the app.
- Keep inline styles out; semantic tags only, so Jira applies its own theme
  (preserves the spirit of the old "Jira owns theme colors" decision).

## Testing

- Phases 0–3: Vitest unit tests (existing files extended). The swap phases
  must not change any Phase 0 golden output except where this spec explicitly
  changes behavior (markdown escaping if accepted; rich clipboard).
- Phase 4: unit-test payload construction; manually verify a real paste into
  Jira from the running app (clipboard + WebView behavior can't be fully
  unit-tested).
- Full gate per phase: frontend tests + typecheck + lint green before moving on.

## Risks

- DOMPurify semantics differ subtly from the hand-rolled walker (e.g. what
  unwraps vs. drops). Mitigated by Phase 0 golden tests written against
  *current* behavior first.
- `@tiptap/markdown` output format may not byte-match the pinned markdown
  (escaping, list markers, blank-line policy). Budget for renderer overrides
  or a light post-process; the Jira-paste readability is the acceptance bar,
  not byte equality.
- WebView clipboard `text/html` support is uncertain → spike + plugin fallback
  is designed in.
- Bundle: DOMPurify ~7 kB gzip, @tiptap/markdown pulls `marked` — acceptable
  for a desktop app.
