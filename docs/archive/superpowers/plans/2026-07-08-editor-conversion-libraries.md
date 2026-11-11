# Editor Conversion Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace qa-scribe's hand-rolled editor HTML sanitizer with DOMPurify, the custom HTML→Markdown clipboard walker with `@tiptap/static-renderer`, and add a rich `text/html` Jira clipboard flavor alongside the plain-markdown fallback.

**Architecture:** The editor stays TipTap 3.27.1. `sanitizeNoteHtml` keeps its signature but delegates dangerous-markup removal to DOMPurify and applies the existing per-tag app-semantics helpers as a post-pass over DOMPurify's DOM output. Clipboard markdown is serialized from the TipTap JSON document (`renderToMarkdown`) instead of walking HTML. The JSON-level URL sanitizer in `editorDocument.ts` stays (it guards the `bodyJson → setContent` path).

**Tech Stack:** React 19 + TipTap 3.27.1, Vitest (jsdom), Bun. New deps: `dompurify`, `@tiptap/static-renderer@^3.27.1`.

**Spec:** `docs/superpowers/specs/2026-07-08-editor-conversion-libraries-design.md` — read its Invariants section before starting any task.

## Global Constraints

- All frontend commands run from `/Users/vriesd/projects/qa-scribe/frontend`.
- Test: `bunx vitest run <file>`; full gate per task: `bun run test && bun run check`.
- Allowed tags stay single-sourced from `src/bindings.ts` (`EDITOR_HTML_TAGS = ["a","b","br","em","h2","h3","i","img","input","li","ol","p","strong","ul"]`, `SELF_CLOSING_EDITOR_HTML_TAGS = ["br","img","input"]`, `MANAGED_ATTACHMENT_PROTOCOL = "qa-scribe-attachment://"`), imported via `../tauri` as today. Never hardcode the tag list or protocol in new code.
- `@tiptap/static-renderer` must be pinned to the same range as the other TipTap packages: `^3.27.1`.
- Public function signatures that survive: `normalizeEditorHtml(value: string): string`, `formatRecordForClipboard(record: ClipboardRecord): ClipboardPayload`, `copyRecordForJira(record: ClipboardRecord): Promise<void>`, `managedAttachmentReferencesForClipboard(record: ClipboardRecord): ClipboardImageReference[]`.
- Behavior changes allowed ONLY in: markdown escaping/spacing cosmetics (Task 4, reviewed diff) and the new `html` clipboard flavor (Task 6). Everything else is behavior-preserving.
- Commit after every task (small, conventional-commit style, matching repo history e.g. `fix(test): …`, `feat: …`).

---

### Task 1: Characterization tests for the sanitizer (Phase 0a)

**Files:**
- Modify: `frontend/src/editor/editorHtml.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `normalizeEditorHtml` from `./editorHtml` (already imported in this test file).
- Produces: golden tests that Tasks 3 and 5 must keep green unchanged.

These tests pin CURRENT behavior — they must PASS immediately. If one fails, the expectation is wrong: fix the expectation to match actual output (print it), never the production code.

- [ ] **Step 1: Read the existing test file** (`frontend/src/editor/editorHtml.test.ts`) and skip any case below already covered there.

- [ ] **Step 2: Append the characterization tests**

```ts
describe('sanitizer characterization (pins behavior for DOMPurify swap)', () => {
  it('strips javascript: hrefs but keeps the link text', () => {
    expect(normalizeEditorHtml('<p><a href="javascript:alert(1)">x</a></p>')).toBe('<p><a>x</a></p>')
  })

  it('removes event handler attributes', () => {
    expect(normalizeEditorHtml('<p><img src="https://a.test/i.png" onerror="alert(1)" /></p>')).toBe(
      '<p><img src="https://a.test/i.png"></p>',
    )
  })

  it('drops script/style/svg/math/iframe including their content', () => {
    for (const html of [
      '<p>a</p><script>alert(1)</script>',
      '<p>a</p><style>p{color:red}</style>',
      '<p>a</p><svg><animate onbegin="alert(1)" /></svg>',
      '<p>a</p><math><mtext>x</mtext></math>',
      '<p>a</p><iframe src="https://a.test"></iframe>',
    ]) {
      expect(normalizeEditorHtml(html)).toBe('<p>a</p>')
    }
  })

  it('unwraps unknown tags but keeps their content', () => {
    expect(normalizeEditorHtml('<div><p>a <span>b</span></p></div>')).toBe('<p>a b</p>')
  })

  it('removes HTML comments', () => {
    expect(normalizeEditorHtml('<p>a<!-- evil --></p>')).toBe('<p>a</p>')
  })

  it('strips id/name attributes (DOM clobbering)', () => {
    expect(normalizeEditorHtml('<p id="location" name="body">a</p>')).toBe('<p>a</p>')
  })

  it('strips per-tag-invalid attributes from allowed tags', () => {
    expect(normalizeEditorHtml('<p href="https://a.test" data-checked="true">a</p>')).toBe('<p>a</p>')
    expect(normalizeEditorHtml('<ol data-type="taskList"><li>a</li></ol>')).toBe('<ol><li>a</li></ol>')
  })

  it('neutralizes mXSS-style nesting', () => {
    const out = normalizeEditorHtml('<p><svg><p><img src="x" onerror="alert(1)"></p></svg></p>')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('<svg')
  })

  it('removes non-checkbox inputs entirely', () => {
    expect(normalizeEditorHtml('<p><input type="text" value="x" /></p>')).toBe('')
  })

  it('normalizes task items and keeps checkbox state', () => {
    expect(
      normalizeEditorHtml(
        '<ul data-type="taskList" class="x"><li data-type="taskItem" style="color:red"><input type="checkbox" checked onclick="x()" />done</li></ul>',
      ),
    ).toBe(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><input type="checkbox" checked="">done</li></ul>',
    )
  })

  it('canonicalizes managed attachment images', () => {
    expect(normalizeEditorHtml('<p><img src="qa-scribe-attachment://abc" class="x" alt="shot" /></p>')).toBe(
      '<p><img data-attachment-id="abc" src="qa-scribe-attachment://abc" alt="shot"></p>',
    )
  })

  it('keeps relative link hrefs (resolved against an http(s) base)', () => {
    expect(normalizeEditorHtml('<p><a href="/tickets/1">t</a></p>')).toBe(
      '<p><a href="/tickets/1" target="_blank" rel="noreferrer">t</a></p>',
    )
  })
})
```

- [ ] **Step 3: Run and reconcile expectations with actual current output**

Run: `bunx vitest run src/editor/editorHtml.test.ts`
Expected: PASS. For any failure, log the actual output (`console.log(normalizeEditorHtml(...))`), confirm it is safe/sane, and update the expectation to the actual string. Attribute ORDER in expectations must match serializer output — fix order, don't fight it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/editor/editorHtml.test.ts
git commit -m "test(editor): pin sanitizer behavior ahead of DOMPurify swap"
```

---

### Task 2: Golden snapshot for clipboard markdown (Phase 0b)

**Files:**
- Modify: `frontend/src/editor/clipboardExport.test.ts` (append)

**Interfaces:**
- Consumes: `formatRecordForClipboard` from `./clipboardExport`.
- Produces: kitchen-sink inline snapshot that Task 4 diffs against.

- [ ] **Step 1: Append a kitchen-sink characterization test** (match the existing file's import style):

```ts
it('renders a kitchen-sink document to markdown (golden)', () => {
  const payload = formatRecordForClipboard({
    title: 'Release check',
    bodyHtml: [
      '<h2>Summary</h2>',
      '<p><strong>Gmail</strong> sign-in <em>fails</em> for <a href="https://example.test/t/1">the ticket</a> and https://example.test/plain.</p>',
      '<p>Line one<br />line two</p>',
      '<ul><li>alpha</li><li>beta<ul><li>nested</li></ul></li></ul>',
      '<ol><li>first</li><li>second</li></ol>',
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><input type="checkbox" checked />done</li><li data-type="taskItem" data-checked="false"><input type="checkbox" />open</li></ul>',
      '<p><img src="qa-scribe-attachment://abc" alt="screenshot" /></p>',
      '<p><img src="https://example.test/ext.png" alt="external" /></p>',
      '<h3>Notes</h3>',
      '<p>literal *stars* and _underscores_ and # hash</p>',
    ].join(''),
  })
  expect(payload.plain).toMatchInlineSnapshot()
})
```

Note: `<a href="https://example.test/plain">https://example.test/plain</a>`-style label==href links are what TipTap's autolink produces; the bare URL in the paragraph text above exercises that after the HTML passes through `richEditorDocumentFromHtml` in Task 4. Also add a second smaller test with an explicit label==href anchor: `'<p><a href="https://example.test/x">https://example.test/x</a></p>'` → snapshot.

- [ ] **Step 2: Run to auto-fill the inline snapshot, then review it**

Run: `bunx vitest run src/editor/clipboardExport.test.ts`
Expected: PASS with vitest writing the snapshot into the file. Read the filled snapshot and sanity-check: `## Release check` first, `- [x] done`, `Image: screenshot`, `![external](https://example.test/ext.png)`, label==href rendered bare.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/editor/clipboardExport.test.ts
git commit -m "test(editor): pin clipboard markdown output ahead of serializer swap"
```

---

### Task 3: DOMPurify replaces the sanitizer core (Phase 1)

**Files:**
- Modify: `frontend/src/editor/editorHtml.ts`
- Modify: `frontend/package.json` (via `bun add dompurify`)

**Interfaces:**
- Consumes: DOMPurify (`sanitize` with `RETURN_DOM`), existing per-tag helpers in the same file.
- Produces: `sanitizeNoteHtml(value: string): string` — same signature/behavior; internals swapped. All Task 1 tests stay green.

- [ ] **Step 1: Install**

Run: `cd /Users/vriesd/projects/qa-scribe/frontend && bun add dompurify`

- [ ] **Step 2: Replace the traversal with DOMPurify + post-pass**

In `editorHtml.ts`, delete `sanitizeEditorHtmlTree`, `sanitizeEditorChildren`, `sanitizeEditorElement`, and `unwrapElement` (lines ~132–191, 260–267). Keep `removeAllAttributes` and the five per-tag helpers (`sanitizeLinkElement`, `sanitizeImageElement`, `sanitizeInputElement`, `sanitizeUnorderedListElement`, `sanitizeListItemElement`) — they become the post-pass. Replace `sanitizeNoteHtml`:

```ts
import DOMPurify from 'dompurify'

// DOMPurify owns dangerous-markup removal (mXSS, namespace confusion, event
// handlers, comments). The post-pass below only enforces app semantics:
// per-tag attribute allowlists, URL policy, managed-attachment
// canonicalization, and task-list normalization.
const editorPurifyConfig = {
  ALLOWED_TAGS: [...EDITOR_HTML_TAGS],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'data-attachment-id', 'type', 'checked', 'data-type', 'data-checked'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  // Default DOMPurify URI policy rejects the qa-scribe-attachment: scheme;
  // extend it. Per-context tightening (http/https/mailto only for links,
  // etc.) still happens in the post-pass helpers.
  ALLOWED_URI_REGEXP: managedProtocolAwareUriRegexp(),
  // These drop CONTENT too (matching the old removedEditorTags semantics);
  // all other disallowed tags unwrap via DOMPurify's default KEEP_CONTENT.
  FORBID_CONTENTS: ['embed', 'form', 'iframe', 'math', 'meta', 'object', 'script', 'style', 'svg', 'template'],
  RETURN_DOM: true,
} as const

function managedProtocolAwareUriRegexp(): RegExp {
  const scheme = managedAttachmentProtocol.replace(/:\/\/$/, '')
  return new RegExp(`^(?:(?:(?:f|ht)tps?|mailto|${scheme}):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`, 'i')
}

function sanitizeNoteHtml(value: string): string {
  const body = DOMPurify.sanitize(value, editorPurifyConfig)
  applyEditorAttributePolicy(body)
  return body.innerHTML.trim()
}

function applyEditorAttributePolicy(root: Node & ParentNode) {
  // Inputs before list items: taskItem normalization reads checkbox state.
  root.querySelectorAll('input').forEach((input) => sanitizeInputElement(input))
  root.querySelectorAll('a').forEach((link) => sanitizeLinkElement(link))
  root.querySelectorAll('img').forEach((image) => sanitizeImageElement(image))
  root.querySelectorAll('ul').forEach((list) => sanitizeUnorderedListElement(list))
  root.querySelectorAll('li').forEach((item) => sanitizeListItemElement(item))
  root.querySelectorAll('b, br, em, h2, h3, i, ol, p, strong').forEach(removeAllAttributes)
}
```

Delete the now-unused `removedEditorTags` set (its list moved into `FORBID_CONTENTS`) and, if nothing else references them after this change, `nonSelfClosingEditorTags` etc. — check with `bun run typecheck` + eslint's unused-var errors rather than guessing.

- [ ] **Step 3: Run the sanitizer tests**

Run: `bunx vitest run src/editor/editorHtml.test.ts`
Expected: PASS, including every Task 1 characterization test. Known divergence risks and their fixes:
- Attribute output order may differ → characterization expectations compare full strings; if only order changed, update the expectation and note it in the commit message.
- If `qa-scribe-attachment://` srcs vanish, the URI regexp isn't matching — verify `managedProtocolAwareUriRegexp` against the constant.
- If removed-tag content leaks (e.g. style text), confirm `FORBID_CONTENTS` is set.

- [ ] **Step 4: Run the full suite and checks**

Run: `bun run test && bun run check`
Expected: PASS (editorDocument, clipboardExport, RichTextEditor tests all funnel through the sanitizer).

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/bun.lock frontend/src/editor/editorHtml.ts
git commit -m "feat(editor): replace hand-rolled HTML sanitizer core with DOMPurify"
```

---

### Task 4: Markdown via @tiptap/static-renderer (Phase 2)

**Files:**
- Modify: `frontend/src/editor/clipboardExport.ts`
- Modify: `frontend/src/editor/clipboardExport.test.ts` (snapshot updates only if cosmetic)
- Modify: `frontend/package.json` (via `bun add @tiptap/static-renderer@^3.27.1`)

**Interfaces:**
- Consumes: `richEditorDocumentFromHtml(html: string): RichEditorDocument` and `richTextEditorExtensions()` (existing); `renderToMarkdown` from `@tiptap/static-renderer/pm/markdown`.
- Produces: `formatRecordForClipboard(record: ClipboardRecord): ClipboardPayload` unchanged signature; internals serialize `RichEditorDocument.doc` JSON → markdown. `renderMarkdownBody(bodyHtml: string): string` module-private.

- [ ] **Step 1: Install**

Run: `cd /Users/vriesd/projects/qa-scribe/frontend && bun add @tiptap/static-renderer@^3.27.1`

- [ ] **Step 2: Confirm mapping callback signatures**

Open `node_modules/@tiptap/static-renderer/dist/pm/markdown/index.d.ts` and confirm the `nodeMapping`/`markMapping` callback shape (expected: `({ node, children }) => string` with `node.attrs` available and `children` the rendered string/array). Adjust the code in Step 3 to the real types — the logic stands, only the destructuring may differ.

- [ ] **Step 3: Rewrite the markdown path**

In `clipboardExport.ts`, replace `createNormalizedBody`, `renderPlainChildren`, `renderPlainNode`, `renderPlainInline`, `renderPlainList`, `renderPlainListItem`, `taskItemMarker`, `checkboxMarker`, `renderPlainImage`, `safeLinkHref`, `isSafeImageSource`, `isDataImageSource` with:

```ts
import { renderToMarkdown } from '@tiptap/static-renderer/pm/markdown'
import { richEditorDocumentFromHtml } from './editorDocument'
import { richTextEditorExtensions } from './editorExtensions'
import { isSafeUrlWithProtocols, managedAttachmentIdFromSrc } from './htmlUtils'
import { managedAttachmentProtocol } from './editorHtml'

export function formatRecordForClipboard(record: ClipboardRecord): ClipboardPayload {
  const title = record.title.trim()
  const plainParts = [title ? `## ${title}` : '', renderMarkdownBody(record.bodyHtml)]
    .map((part) => trimBlankLines(part))
    .filter(Boolean)
  return { plain: trimBlankLines(plainParts.join('\n\n')) }
}

function renderMarkdownBody(bodyHtml: string): string {
  const editorDocument = richEditorDocumentFromHtml(bodyHtml)
  return renderToMarkdown({
    extensions: richTextEditorExtensions(),
    content: editorDocument.doc,
    options: {
      nodeMapping: {
        image: ({ node }) => imageMarkdown(node.attrs ?? {}),
      },
      markMapping: {
        // Autolinked URLs (label === href) stay bare, matching the golden
        // snapshot; labeled links render as [label](href).
        link: ({ mark, children }) => {
          const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''
          const label = String(children)
          if (!href) return label
          if (!label || label === href) return href
          return `[${label}](${href})`
        },
      },
    },
  })
}

function imageMarkdown(attrs: Record<string, unknown>): string {
  const src = typeof attrs.src === 'string' ? attrs.src.trim() : ''
  const alt = (typeof attrs.alt === 'string' && attrs.alt.trim()) || 'Attached image'
  const isManaged = Boolean(attrs.attachmentId) || Boolean(managedAttachmentIdFromSrc(src)) || src.startsWith(managedAttachmentProtocol)
  const isPlainRemote = isSafeUrlWithProtocols(src, new Set(['http:', 'https:']))
  // Managed and data: images cannot render outside the app → text placeholder.
  if (isManaged || /^data:image\//i.test(src) || !isPlainRemote) return `Image: ${alt}`
  return `![${alt}](${src})`
}
```

Keep `trimBlankLines`. Rewrite `managedAttachmentReferencesForClipboard` to walk the JSON document instead of a DOM (add the export `managedAttachmentImagesInDocument` to `editorDocument.ts`):

In `editorDocument.ts` add:

```ts
export function managedAttachmentImagesInDocument(document: RichEditorDocument): Array<{ attachmentId: string; alt: string }> {
  const references = new Map<string, { attachmentId: string; alt: string }>()
  walkJsonContent(normalizeRichEditorDocument(document).doc, (node) => {
    if (node.type !== 'image') return
    const attachmentId = stringAttribute(node.attrs?.attachmentId) ?? managedAttachmentIdFromSrc(stringAttribute(node.attrs?.src) ?? '')
    if (!attachmentId || references.has(attachmentId)) return
    references.set(attachmentId, {
      attachmentId,
      alt: stringAttribute(node.attrs?.alt)?.trim() || 'Attached image',
    })
  })
  return Array.from(references.values())
}
```

(`managedAttachmentIdFromSrc` is already imported there via `./htmlUtils`.) Then in `clipboardExport.ts`:

```ts
export function managedAttachmentReferencesForClipboard(record: ClipboardRecord): ClipboardImageReference[] {
  return managedAttachmentImagesInDocument(richEditorDocumentFromHtml(record.bodyHtml))
}
```

- [ ] **Step 4: Run the clipboard tests and reconcile the golden snapshot**

Run: `bunx vitest run src/editor/clipboardExport.test.ts`
Expected: task-list, image-placeholder, link, and title behavior identical. Acceptable diffs (update snapshot via `bunx vitest run src/editor/clipboardExport.test.ts -u` after reviewing): blank-line counts, list-marker spacing, markdown escaping of literal `*`/`_`/`#` in text. UNACCEPTABLE (fix code, not snapshot): lost content, `![...]` for managed images, `[x]` state flips, broken nesting indentation. If the serializer escapes literal `*`/`_` and the escaped text would look wrong pasted into Jira, decide per spec: prefer accepting the (more correct) escaping; only post-process if it garbles ordinary prose.

- [ ] **Step 5: Full suite + checks, then commit**

Run: `bun run test && bun run check`

```bash
git add frontend/package.json frontend/bun.lock frontend/src/editor/clipboardExport.ts frontend/src/editor/clipboardExport.test.ts frontend/src/editor/editorDocument.ts
git commit -m "feat(editor): serialize clipboard markdown via @tiptap/static-renderer"
```

---

### Task 5: Dead-code sweep + JSON-sanitizer audit (Phase 3)

**Files:**
- Modify: `frontend/src/editor/editorHtml.ts`, `frontend/src/editor/htmlUtils.ts`, `frontend/src/editor/editorDocument.ts` (deletions/comments only)

**Interfaces:**
- Consumes: everything landed in Tasks 3–4.
- Produces: no API changes; smaller files, updated comments.

- [ ] **Step 1: Find dead exports**

Run from `frontend/`: for each export in the three files, `grep -rn "<name>" src --include="*.ts*" | grep -v "<defining-file>"` — delete exports with no remaining consumers (candidates: `escapeAttribute` if `managedAttachmentImageHtml` was its last consumer changed, DOM-based helpers left in `clipboardExport.ts`). Rely on `bun run check` (eslint unused rules + tsc) to catch stragglers.

- [ ] **Step 2: Update stale comments**

- `editorDocument.ts` lines ~88–92: the comment references `sanitizeEditorHtmlTree in editorHtml.ts` — point it at the DOMPurify + `applyEditorAttributePolicy` pipeline instead, and state explicitly that this JSON layer is retained on purpose (stored `bodyJson` feeds `editor.commands.setContent` without HTML parsing).
- `editorHtml.ts` header comment: still accurate re: Rust single-sourcing — verify, keep.

- [ ] **Step 3: Verify + commit**

Run: `bun run test && bun run check`

```bash
git add -A frontend/src/editor
git commit -m "refactor(editor): drop dead conversion helpers after library swap"
```

---

### Task 6: Rich Jira clipboard flavor (Phase 4)

**Files:**
- Modify: `frontend/src/editor/clipboardExport.ts`
- Modify: `frontend/src/editor/clipboardExport.test.ts`

**Interfaces:**
- Consumes: `richEditorDocumentFromHtml`, `richEditorDocumentToHtml` (existing), `escapeHtml` from `./htmlUtils`.
- Produces: `ClipboardPayload = { plain: string; html: string }`; `copyRecordForJira` writes both flavors via `navigator.clipboard.write` + `ClipboardItem`, falling back to `writeText(plain)`.

- [ ] **Step 1: Write failing tests**

```ts
describe('rich clipboard payload', () => {
  it('builds an html flavor with heading and placeholder for managed images', () => {
    const payload = formatRecordForClipboard({
      title: 'Bug <one>',
      bodyHtml: '<p><strong>bold</strong></p><p><img src="qa-scribe-attachment://abc" alt="shot" /></p><p><img src="https://a.test/i.png" alt="ext" /></p>',
    })
    expect(payload.html).toContain('<h2>Bug &lt;one&gt;</h2>')
    expect(payload.html).toContain('<strong>bold</strong>')
    expect(payload.html).not.toContain('qa-scribe-attachment://')
    expect(payload.html).toContain('Image: shot')
    expect(payload.html).toContain('<img src="https://a.test/i.png"')
  })

  it('writes text/html and text/plain flavors when ClipboardItem is available', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('ClipboardItem', class {
      items: Record<string, Blob>
      constructor(items: Record<string, Blob>) { this.items = items }
    })
    Object.assign(navigator, { clipboard: { write, writeText: vi.fn() } })

    await copyRecordForJira({ title: 'T', bodyHtml: '<p>a</p>' })

    expect(write).toHaveBeenCalledTimes(1)
    const item = write.mock.calls[0][0][0]
    expect(Object.keys(item.items)).toEqual(['text/html', 'text/plain'])
    vi.unstubAllGlobals()
  })

  it('falls back to plain writeText without ClipboardItem', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await copyRecordForJira({ title: 'T', bodyHtml: '<p>a</p>' })
    expect(writeText).toHaveBeenCalledWith('## T\n\na')
  })
})
```

Match the existing file's clipboard-mocking conventions (read how current tests stub `navigator.clipboard` and mirror that; restore stubs the same way).

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run src/editor/clipboardExport.test.ts`
Expected: FAIL — `payload.html` undefined.

- [ ] **Step 3: Implement**

```ts
export type ClipboardPayload = {
  plain: string
  html: string
}

export function formatRecordForClipboard(record: ClipboardRecord): ClipboardPayload {
  const title = record.title.trim()
  const editorDocument = richEditorDocumentFromHtml(record.bodyHtml)
  const plainParts = [title ? `## ${title}` : '', renderMarkdownFromDocument(editorDocument)]
    .map((part) => trimBlankLines(part))
    .filter(Boolean)
  return {
    plain: trimBlankLines(plainParts.join('\n\n')),
    html: renderClipboardHtml(title, editorDocument),
  }
}

// Semantic tags only, no inline styles — Jira applies its own theme (keeps
// the intent of the old plain-text-only decision).
function renderClipboardHtml(title: string, editorDocument: RichEditorDocument): string {
  const container = document.createElement('div')
  container.innerHTML = richEditorDocumentToHtml(editorDocument)
  container.querySelectorAll('img').forEach((image) => {
    const src = image.getAttribute('src') ?? ''
    if (src.startsWith(managedAttachmentProtocol) || /^data:image\//i.test(src)) {
      const alt = image.getAttribute('alt')?.trim() || 'Attached image'
      image.replaceWith(document.createTextNode(`Image: ${alt}`))
    }
  })
  const heading = title ? `<h2>${escapeHtml(title)}</h2>` : ''
  return `${heading}${container.innerHTML}`
}

export async function copyRecordForJira(record: ClipboardRecord): Promise<void> {
  const payload = formatRecordForClipboard(record)
  const clipboard = navigator.clipboard
  if (clipboard && typeof clipboard.write === 'function' && typeof ClipboardItem !== 'undefined') {
    await clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([payload.html], { type: 'text/html' }),
        'text/plain': new Blob([payload.plain], { type: 'text/plain' }),
      }),
    ])
    return
  }
  await writePlainClipboard(payload.plain)
}
```

(Rename the Task 4 `renderMarkdownBody(bodyHtml)` to `renderMarkdownFromDocument(editorDocument)` taking the already-parsed document so the HTML→JSON conversion runs once; update its body accordingly — it no longer calls `richEditorDocumentFromHtml` itself.)

Check callers: `grep -rn "formatRecordForClipboard\|ClipboardPayload" frontend/src --include="*.ts*"` — update any consumer that destructures the payload.

- [ ] **Step 4: Run tests + checks**

Run: `bunx vitest run src/editor/clipboardExport.test.ts` then `bun run test && bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/editor/clipboardExport.ts frontend/src/editor/clipboardExport.test.ts
git commit -m "feat(editor): copy rich text/html flavor to clipboard for Jira paste"
```

---

### Task 7: Manual end-to-end verification (WebView clipboard)

**Files:** none (verification only; contingency below if it fails)

- [ ] **Step 1: Launch the app** (Tauri dev: check root `package.json`/`Makefile`/`.claude/launch.json` for the dev command, typically `bun tauri dev` or `cargo tauri dev`) and copy a finding/record that has headings, bold, a link, a task list, and a managed image.

- [ ] **Step 2: Inspect the real clipboard flavors on macOS**

Run: `osascript -e 'the clipboard as record' | head -c 400` — confirm both `«class HTML»` and plain-text flavors are present. Then dump the HTML: `osascript -e 'get the clipboard as «class HTML»'` (hex) or paste into TextEdit (rich mode) to confirm formatting; paste into a plain-text editor to confirm the markdown fallback.

- [ ] **Step 3: Contingency — only if `navigator.clipboard.write` fails in the WebView**

Fall back to the Tauri plugin: `cd /Users/vriesd/projects/qa-scribe && cargo add tauri-plugin-clipboard-manager --package qa-scribe` (adjust package name to the Tauri app crate), register the plugin in the Tauri builder, add the `clipboard-manager:allow-write-html` capability, `cd frontend && bun add @tauri-apps/plugin-clipboard-manager`, and in `copyRecordForJira` use `writeHtml(payload.html, payload.plain)` from `@tauri-apps/plugin-clipboard-manager` as the primary path with the existing web-API path as fallback. Commit as `fix(editor): use tauri clipboard plugin for html flavor`.

- [ ] **Step 4: Report** the verification result to Douwe (paste into real Jira is his final acceptance check — we cannot do that from here).

---

## Self-review notes

- Spec coverage: Phase 0 → Tasks 1–2; Phase 1 → Task 3; Phase 2 → Task 4; Phase 3 → Task 5; Phase 4 → Tasks 6–7. Invariants encoded as characterization tests (Task 1) and unacceptable-diff list (Task 4).
- Escaping decision (spec's open point) is operationalized in Task 4 Step 4.
- Type consistency: `ClipboardPayload` gains `html` only in Task 6; Task 4 keeps `{ plain }` — intermediate state is consistent at each commit.
