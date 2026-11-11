# Consistent Markdown formatting

## Restart verification

The original Flow session was deferred with explicit user approval because its immutable baseline could not accept a later authorized generic-data correction to an earlier phase's uncommitted test. Replacement session `session:44d9a337-6cbf-4c30-b909-85fa12ebefbd` accepts exact existing-work paths against Git commit `23f7aeb589c7ba2f0ebe70292dd908a91c572559`. Earlier results below remain historical until freshly validated and reviewed. The four unrelated modified Chat-plan documents remain excluded.

- [x] Reaccept `markdown-contract`: verify the inspectable research and contract against current source.
- [x] Reaccept `markdown-chat`: verify current rendering, safety, shared typography and native layouts.
- [x] Reaccept `markdown-submission`: verify current canonical conversion, persistence/export and generic-data corrections.
- [x] Complete `markdown-verify`: verify cross-surface behavior, deterministic desktop suite and `bun run verify`.
- [ ] Complete `markdown-release`: prepare the stable release PR with green hosted CI, then checkpoint for separate merge authorization.

## Original phase evidence (historical)

- [x] Phase 1 (R1): compare Streamdown and react-markdown with complete, incomplete, adversarial and large fixtures; verify sources and inventory; lock renderer and conversion contract.
- [x] Phase 2 (R2, R3, R5): render assistant Markdown in saved and partial Chat responses; share scoped rich-content typography; verify semantic rendering, safety, streaming and existing lifecycle behavior.
- [x] Phase 3 (R4): preserve supported assistant formatting at transactional Chat-to-Note submission with matching HTML/JSON, readable fallbacks, and persistence/export checks.
- [x] Phase 4 (R5, R6): verify rich-content consistency across the app, deterministic desktop workflow and `bun run verify` on current source.
- [ ] Phase 5 (R7, R8): prepare the next stable release through the documented bump/branch/PR process and verify hosted CI; checkpoint for separate merge authorization before publication.

Re-read this checklist before each phase. Tick a phase only after its evidence is recorded. Preserve the four pre-existing modified Chat plan documents. Implementation stays within these phases. User clarification during Phase 3 requires generic, non-client-domain data throughout the project, including tests. Neutralize newly introduced examples and the two older editor-test/changelog references; regenerate owned Markdown screenshots and rerun affected checks.

## Application-wide verification

Release preparation selects v0.8.4 after fetching protected main at `c7ac356` and confirming published latest v0.8.3. Create release/v0.8.4 from origin/main, commit only the reviewed implementation, and perform the scripted version bump in a clean detached worktree of that commit. Fast-forward the release branch to the resulting metadata commit, then validate the actual release revision in the primary checkout before pushing the release PR. This keeps the four unrelated dirty documents local and gives the transactional bump a clean checkout. No manual tag, merge or publication is authorized by this step.

The replacement submission phase independently passed after repairs to `markdown-submission.R13-01` and `markdown-submission.R13-02`, including canonical `bun run verify`. Phase 4 adds `frontend/src/editor/richContentConsistency.test.tsx`: actual Note/Entry editors, editable and read-only Draft/Finding records, and generated HTML preview receive identical headings, emphasis, nested lists, checked tasks and safe links. Seven mounted rich editors produce identical inner HTML. This checks supported structure and common styling hooks without replacing generated HTML with Markdown. Existing editor/attachment/export tests cover managed-image preservation.

`markdown-chat.R9-01`: a native Range geometry assertion first measured `RIGHTMOST` on nine text lines instead of one. Table cells now override inherited `overflow-wrap:anywhere` with normal word wrapping, retaining independent horizontal scrolling. The same actual native scenario now measures one text line in both themes at 1280/640; table content width 1613px stays inside 848/548px regions, rightmost cells remain visible after scrolling, and page/transcript widths remain bounded. Updated light-narrow and dark-desktop screenshots were inspected. Native keyboard default scrolling and system clipboard payload readback remain unclaimed.

Focused command `bun run frontend:test -- src/editor/richContentConsistency.test.tsx && QA_SCRIBE_E2E_SPEC=../../../../../../tmp/opencode/qa-scribe-markdown-native.mjs QA_SCRIBE_E2E_ARTIFACTS=artifacts/markdown-ui xvfb-run -a bun run e2e && xvfb-run -a bun run e2e` passed. The full maintained desktop suite passed all nine isolated invocations: Session lifecycle, manual Testware, clipboard, generation/cancellation, summary recovery, Chat-to-Note, and Codex/Claude/Copilot authorization. `artifacts/e2e/latest-run.json` records exit 0 and isolation cleanup; each invocation has machine execution evidence. Optional real authenticated providers are not substituted for deterministic fixtures.

## Surface inventory

| Surface | Current representation | Intended treatment |
| --- | --- | --- |
| Completed assistant Chat | Canonical plain text, displayed in a paragraph | Markdown display, preserve canonical text |
| Partial assistant response | Plain text, displayed in a paragraph | Incremental Markdown display, keep completion/deduplication rules |
| User Chat, permissions, errors | Literal text | Remain literal |
| Session Note and Entry bodies | Sanitized HTML plus optional canonical Tiptap JSON | Existing editor schema and shared typography |
| Drafts and Findings | Existing rich-record/editor components | Same supported content typography |
| Generated record preview | AI-requested HTML fragment | Existing sanitized HTML import, never heuristic Markdown parsing |
| Chat submission | Escaped paragraphs and matching JSON text/hardBreak nodes | Parse canonical assistant Markdown transactionally, keep literal user text |
| Clipboard | Tiptap document exported to semantic HTML and Markdown | Preserve existing rich export contract |

Source anchors: `frontend/src/views/SessionChatView.tsx`, `frontend/src/editor/editorExtensions.ts`, `frontend/src/editor/editorDocument.ts`, `frontend/src/views/RichRecordView.tsx`, `frontend/src/editor/clipboardExport.ts`, `crates/qa-scribe-core/src/services/session_service/chat_submission.rs`.

## Research and comparison

Selected **react-markdown 10.1.0 with remark-gfm 4.0.1**. Streamdown 2.7.0 was evaluated, not installed in the application. Keep the existing CSS system; do not add Tailwind, math, diagrams or syntax-highlighting engines.

The isolated experiment used React/React DOM 19.3.1, Bun 1.4.0 and esbuild 0.28.2 in `/tmp/opencode/qa-scribe-markdown-comparison`. It rendered both candidates with `renderToStaticMarkup`, an image component returning alt text, and an HTTP(S)/mailto URL transform. React-markdown enabled remark-gfm; Streamdown used streaming mode, `skipHtml` and disabled controls. The temporary experiment is diagnostic, not an application benchmark or maintained test suite.

| Fixture | react-markdown/GFM | Streamdown |
| --- | --- | --- |
| Heading, bold, code, nested list, task, quote, table | All structures rendered; semantic strong element | All structures rendered; bold uses styled span |
| `**Unfinished` | Readable literal delimiters until completed | Formats unfinished emphasis |
| Unclosed fenced code | Code block rendered | Code block rendered |
| Unclosed link | Literal opening syntax plus GFM-autolinked URL | Link label with empty pending href in this policy |
| Partial table row | Table with empty pending cell | Table with empty pending cell |
| Script, JavaScript link, remote image | Script escaped, unsafe href empty, alt-text span only | Script omitted, unsafe link blocked, alt-text span only |
| 2,500 repeated heading/list sections (about 100 KiB) | Completed without throwing, 217,499 output bytes | Completed without throwing, 1,105,106 output bytes |
| Minified browser bundle including React/React DOM | 380,803 bytes; gzip 118,166 bytes | 763,744 bytes; gzip 235,027 bytes |

Both browser bundles were built from a minimal `createRoot` renderer entry using esbuild production/minification, no CSS or optional plugins. These are comparative standalone bundle costs, not the app's incremental Vite sizes. Large-fixture server render samples were roughly 0.5-0.6 seconds versus 1.1 seconds; single samples do not establish interactive performance. The production app build remains a Phase 2/4 check.

The experiment initially asserted a semantic strong element for both candidates and failed for Streamdown. Inspection showed its documented utility-styled span instead; the rerun recorded semantic-tag differences rather than treating equivalent visual formatting as a product defect. All safety assertions and seven fixtures then passed. Validation command: `bun /tmp/opencode/qa-scribe-markdown-comparison/compare.mjs`, run from that experiment directory. Flow validation `20287bf6-8af2-405f-9fe8-1830636cf378` captured the successful comparison after the initial diagnostic failure.

Decision: Streamdown's incomplete-emphasis repair is useful but does not justify the larger bundle and utility-styling adaptation for the bounded Chat transcript. Standard parsing with readable incomplete delimiters satisfies this contract. Reassess only if observed app streaming behavior demonstrates a remaining usability problem.

Primary sources reviewed through Exa and Ref:

- <https://streamdown.ai/docs/getting-started>: streaming-focused React renderer; documented styling setup uses Tailwind.
- <https://streamdown.ai/docs/styling>: component overrides and scoped data attributes are available; built-in design tokens differ from this app's tokens.
- <https://streamdown.ai/docs/security>: sanitizer/hardening layers; default remote images are permissive and must be restricted; overriding plugin arrays replaces defaults.
- <https://github.com/remarkjs/react-markdown/blob/main/readme.md#security>: safe defaults; URL transformations, plugins and components can weaken security.

## Formatting contract

Assistant Chat supports headings, emphasis, nested lists, tasks, links, inline/fenced code, quotes and GFM tables. Streaming content may be incomplete; it must remain readable, never throw, and settle to correct completed content without duplicate final responses. Literal syntax in an unfinished construct is acceptable until its delimiter arrives. Original transcript text remains unchanged.

Raw HTML is displayed literally, never executed. Markdown images display descriptive text without fetching remote or data resources. Only explicit safe absolute HTTP(S)/mailto links are interactive. User messages, permission arguments and provider descriptions remain literal, including Markdown syntax.

Submission uses the canonical stored assistant text, not client-supplied replacement content, and emits HTML and JSON from the same parsed representation. Existing editor capabilities remain authoritative: heading levels 2/3, bold/italic, lists, tasks and safe links. Normalize h1 to h2 and h4-h6 to h3. Unsupported inline code/strike retain text; fenced code and quotes retain readable paragraph text and line boundaries. Tables retain header/cell text in readable rows. Remote images become alt text. Raw HTML remains literal text. Never silently discard unsupported content.

Keep transaction boundaries, optimistic Note comparisons, role labels, receipts, size limits, and managed attachment nodes. No migration or reinterpretation of existing stored HTML. Existing generated HTML stays HTML.

## Validation and release

Observe new semantic regressions fail before fixes. Run focused component and Rust submission checks, existing permission/recovery/deduplication checks, desktop handoff and supported-theme/narrow-layout inspection. Canonical broad gate: `bun run verify` (README and root package manifest). Record actual outputs, not inferred behavioral success from compilation.

Follow `docs/releasing.md`. The next version is provisional until checking origin/main and releases. Use the single version bump script, real changelog and explicit intended-file staging. A reviewed release PR and green hosted CI precede separately authorized merge. The release workflow creates the tag at the merge SHA; verify its actual run, non-draft release and expected assets afterward.

### Phase 2 evidence

- Watched the new saved/partial semantic heading tests fail against the plain-paragraph implementation (35 existing tests passed). The renderer tests now cover safe/inert URLs, escaped raw HTML, non-fetching image alt text and every prefix of a mixed Markdown response. Existing permission/recovery/cancellation/deduplication tests remain in the full frontend suite.
- `bun run frontend:check && bun run frontend:test && bun run frontend:build`: 52 files / 493 tests passed, typecheck/lint/CSS/54 contrast pairs passed, production Vite build passed. Main script gzip 64.51 kB, vendor gzip 148.81 kB, editor gzip 135.59 kB. These are resulting bundle sizes, not claimed incremental deltas. Initial new-test text matching and a control-character-regex lint failure were fixed without reducing acceptance.
- Native WebKitGTK verification command: `QA_SCRIBE_E2E_SPEC=../../../../../../tmp/opencode/qa-scribe-markdown-native.mjs QA_SCRIBE_E2E_ARTIFACTS=artifacts/markdown-ui xvfb-run -a bun run e2e`. Uses the real built Tauri application and isolated runner, not a browser mock. One deterministic provider test passed. Screenshots: `artifacts/markdown-ui/markdown-{light,dark}-{1280,640}.png`; machine execution/logs beside them. 640px is the app's narrow native window tested here, not a claim of a mobile app.
- Native scenario: create Session through UI, choose Chat, send literal `**Keep my input literal**`, receive an 800-byte initial assistant Markdown delta, assert a partial h2 and available cancellation, then release the provider to finish. Assert saved h2/bold/nested list/checked task/table, unchanged literal user text, no script/img/iframe or executed script marker and no duplicate partial section. Provider returns the fixture below through Codex JSON-RPC (`initialize`, `config/read`, `model/list`, `thread/start`, `turn/start`, scoped `item/agentMessage/delta`, `item/completed`, `turn/completed`). It replaces only the isolated fixture-directory provider symlink with a temporary executable, never app commands, app state or repository fixtures.
- The fixture's original 80-byte first delta did not flush because existing transport emits partials after 512 bytes or a later update after 250ms. Two native partial-wait attempts timed out; an 800-byte delta with explicit marker-file release passed deterministically. No transport change was made.
- For each light/dark theme and 1280/640 window: set native window size and root theme, assert document width does not exceed viewport, transcript scroll width equals its client width, and long code scroll width exceeds its own client width. Observed page widths 1280/640, transcript widths 880/580, code client widths 846/546, code scroll width 7542. Reviewed dark desktop and light narrow screenshots: clear heading/list/table hierarchy, bounded code overflow, wrapped handoff controls. Detected mixed-list bullet suppression and narrowed the task-specific list-style rule to task items only before final revalidation.

Exact native response fixture and browser assertions (the temporary runner's test body uses WDIO with native UI selectors):

The review retry extends the initial two-column fixture below with a 32-column table: headers `['Check', 'Result', ...Array.from({length: 30}, (_, i) => 'C' + (i + 1))]`, cells `['Linking', 'Pass', ...Array.from({length: 29}, (_, i) => 'V' + (i + 1)), 'RIGHTMOST']`, and one `---` separator per header. Rows join cells with ` | ` inside pipe delimiters. It also inserts `### Details` after the introductory paragraph. Native computed-style assertion first failed with `marginTop === '0px'` versus expected `'16px'`; the class-based reset is now separated from the element reset to restore heading spacing (markdown-chat.R22-02).

For markdown-chat.R22-01, the retry additionally asserts `table.scrollWidth > table.clientWidth`, focuses the actual `.markdown-table-scroll` region and checks it is the active element, then sets that region's scroll position to its maximum and asserts the final `RIGHTMOST` cell's rectangle lies within the region. Existing no-page/no-transcript-overflow assertions run in all four theme/width combinations. This replaces the original fitting-table-only coverage; it does not weaken those earlier assertions. The embedded WebDriver key actions did not produce horizontal default scrolling with either End or ArrowRight, so keyboard scrolling itself is not claimed as exercised. Focusability and actual region scrolling/rightmost-cell reachability are observed separately.

```js
const markdown = '## Requirements\n\n**Important** and `record_id`\n\n- Parent\n  - Nested\n- [x] Verified\n\n> Context retained\n\n```sql\n' + 'select record_id from sample_records; '.repeat(30) + '\n```\n\n| Check | Result |\n| --- | --- |\n| Linking | Pass |\n\n[Reference](https://example.com)\n\n![No remote request](https://example.com/tracker)\n\n<script>window.markdownUnsafe = true</script>'
// Provider sends markdown.slice(0, 800), then polls every 100ms for
// QA_SCRIBE_E2E_FIXTURE_DIR + '/markdown.release'. Test writes that file
// only after these partial-state assertions:
await browser.waitUntil(async () => browser.execute(() => document.querySelector('.chat-partial .markdown-content h2')?.textContent === 'Requirements'), { timeout: 15000 })
assert.equal(await $('button=Cancel response').isEnabled(), true)
// Provider then emits markdown.slice(800), a complete snapshot, and terminal turn.
await browser.waitUntil(async () => browser.execute(() => document.querySelector('.chat-message-assistant .markdown-content h2')?.textContent === 'Requirements'), { timeout: 15000 })
const result = await browser.execute(() => {
  const content = document.querySelector('.chat-message-assistant .markdown-content')
  return {
    heading: content.querySelector('h2')?.textContent,
    bold: content.querySelector('strong')?.textContent,
    nested: Boolean(content.querySelector('ul ul')),
    checked: content.querySelector('input[type="checkbox"]')?.checked,
    table: content.querySelector('table')?.textContent,
    user: document.querySelector('.chat-message-user .chat-message-text')?.textContent,
    unsafe: Boolean(content.querySelector('script,img,iframe')) || Boolean(window.markdownUnsafe),
    partial: Boolean(document.querySelector('.chat-partial')),
  }
})
assert.equal(result.heading, 'Requirements')
assert.equal(result.bold, 'Important')
assert.equal(result.nested, true)
assert.equal(result.checked, true)
assert.match(result.table, /Linking/)
assert.equal(result.user, '**Keep my input literal**')
assert.equal(result.unsafe, false)
assert.equal(result.partial, false)
```

### Phase 3 evidence

The new Rust heading/list integration regression failed against literal submission, then passed for HTML-only and JSON-backed Notes. Parser dependency: pulldown-cmark 0.13.4 without default features; Ref primary README describes pull events, GFM table/task/strike options and separated parsing/rendering (<https://github.com/pulldown-cmark/pulldown-cmark>). Its unreleased main-branch `std` feature does not exist in 0.13, so it is not enabled. `url` 2.5.8 is already in the lockfile and is now a direct core dependency for absolute scheme validation.

Only canonical newly submitted assistant text is parsed. User content remains literal. Heading levels normalize to 2/3, marks/links/lists/tasks map to the current schema, mixed task/ordinary lists split into compatible consecutive lists, and nested task blocks flatten into readable paragraphs. Raw HTML becomes escaped text, image URLs are discarded in favor of alt text, tables become pipe-delimited text rows, and code/quote lines survive as paragraphs/hard breaks. Depth at 48 open frames falls back to the complete literal message. HTML derives from the same JSON nodes, so no independent parser can disagree with the canonical additions. Existing transaction, receipt, optimistic comparison, original Note nodes and size checks remain intact.

Focused checks: 37 Rust Chat storage tests passed, including canonical Markdown HTML/JSON, fallback boundaries and Unicode, original managed images/content, stale Note rollback, repeat receipts, deep nesting and size expansion rollback; core Clippy passed. Frontend editor/clipboard checks passed 27 tests, including JSON/HTML/save/reopen hard-break preservation and copy-ready fallback lines. The plain-text helper intentionally strips HTML separators; line-preservation checks target actual stored nodes, HTML breaks and clipboard output instead.

The native scenario above was extended after its layout loop: count actual provider `turn/start` requests in an isolated marker file; submit with the real button; assert Note h2/h3/bold/checked task and all fallback text (including literal script markup); insert ` Reviewed by tester.` through native contenteditable selection/`execCommand`; wait for saved status; switch to a new Session and reopen the original; reacquire the newly mounted editor and assert the edit and heading persist; click Copy note for Jira and observe its copied state; assert the provider request journal is unchanged. Screenshot: `artifacts/markdown-ui/markdown-submitted-note.png`. Initial harness attempts hit hidden navigation at 640px and a detached editor reference after reopen; restoring desktop width for navigation and reacquiring the editor fixed the harness. The native workflow then passed. Clipboard payload semantics are verified by frontend tests; native copied state verifies the actual command completed, not readback from the system clipboard.

During this phase the user required generic examples everywhere. The editor fixture, Markdown tests/evidence and temporary native provider now use generic record/sample data. The older editor-test and changelog descriptions were also neutralized. A source search with whole-word client-name/domain identifiers found no remaining references; dependency checksum substrings are not content references. Owned native screenshots are regenerated from generic fixtures rather than retained from earlier examples.

## Inspectable research evidence (markdown-contract.R7-01)

### Submission review repairs

`markdown-submission.R13-01` identified a downstream legacy-repair defect: canonical paragraph HTML containing escaped allowed tags could be decoded again, turning literal examples into images or formatting. Five new editor/clipboard regressions failed under the unchanged canonical `bun run verify` before repair. The recorded same-goal prerequisite amendment permits only the necessary sanitizer/export boundary changes and their checks.

Legacy escaped-HTML repair now applies only when the input contains no genuine editor tags. Fully escaped historical Notes (including a plain title before escaped tags) retain their existing tested import behavior, while escaped examples inside genuine HTML paragraphs remain literal. JSON-derived HTML, HTML-only imports and clipboard output share this boundary. `markdown-submission.R13-02` is addressed by allowing and validating signed 32-bit ordered-list `start` attributes and retaining the parent start when calculating clipboard item numbers, including mixed ordered/task lists.

Regression fixtures use generic raw and fenced `<img src="https://example.test/literal-raw">` / `<strong>` examples and a list starting at 7. Both Rust HTML-only/JSON-backed submission paths assert escaped output and numbering. Frontend tests cover both body formats through import/save/reopen and both clipboard flavors; existing legacy import tests remain. The actual native provider response now includes raw and fenced allowed tags, asserts they remain exact literal Note text without image nodes through submission and reopen, and checks `ol start="7"` before copy. The fake host names contain no user data.

Relevant primary-source excerpts fetched through Exa/Ref in this session:

- Streamdown getting started: "Tailwind CSS (for styling)" is listed under Requirements; "Streamdown uses Tailwind CSS for styling."
- Streamdown styling: "Every Streamdown element includes a unique `data-streamdown` attribute" and "You can scope your styles to specific instances of Streamdown by using the `className` prop."
- Streamdown security: "By default, Streamdown is configured with permissive security to allow maximum functionality"; its shown defaults include `allowedImagePrefixes: ["*"]` and `allowDataImages: true`. "The `rehypePlugins` prop replaces the entire default array" when overriding plugins.
- Ref react-markdown Security: "Use of `react-markdown` is secure by default." "Overwriting `urlTransform` to something insecure will open you up to XSS vectors." Plugins and components may also be insecure.

Exact experiment source follows. Dependency resolution produced react/react-dom 19.3.1, react-markdown 10.1.0, remark-gfm 4.0.1, streamdown 2.7.0, esbuild 0.28.2. The temporary manifest was a private ESM package declaring those six packages (`^19.3.0` for React/DOM and `latest` for the other four); these resolved versions, not future latest versions, define this measurement. No additional plugins or CSS were bundled.

The safety checks below are assertions. Semantic structure is logged for inspection, not asserted after discovering Streamdown's span-based bold. Incomplete content and output-size differences were inspected in the captured output. This is not a claim of browser interaction, visual equivalence, or a streaming timing benchmark.

```js
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import gfm from 'remark-gfm'
import { Streamdown } from 'streamdown'
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import assert from 'node:assert/strict'

const fixtures = {
  complete: '# Heading\n\n**Bold** and `code`\n\n- parent\n  - nested\n- [x] checked\n\n> quote\n\n```js\nconst x = 1\n```\n\n| Name | Result |\n| --- | --- |\n| test | pass |',
  emphasis: '**Unfinished',
  fence: '```js\nconst x = 1',
  link: '[Pending](https://example.com',
  table: '| Name | Result |\n| --- | --- |\n| test |',
  adversarial: '<script>alert(1)</script>\n\n[x](javascript:alert%281%29)\n\n![tracker](https://example.com/track)',
  large: ('## Check\n\n- **Requirement** and `value`\n\n').repeat(2500),
}
const safeUrl = (url) => /^(https?:\/\/|mailto:)/i.test(url) ? url : ''
const components = { img: ({ alt }) => React.createElement('span', null, alt || 'Image') }
for (const [name, Component] of [['react-markdown', Markdown], ['streamdown', Streamdown]]) {
  const props = name === 'react-markdown'
    ? { remarkPlugins: [gfm], urlTransform: safeUrl, components }
    : { mode: 'streaming', skipHtml: true, urlTransform: safeUrl, components, controls: false }
  for (const [fixture, text] of Object.entries(fixtures)) {
    const start = performance.now()
    const html = renderToStaticMarkup(React.createElement(Component, props, text))
    assert(!html.includes('<script') && !html.includes('href="javascript:') && !html.includes('<img'))
    console.log(JSON.stringify({ renderer: name, fixture, ms: Math.round(performance.now() - start), bytes: html.length, output: fixture === 'large' ? '(omitted large output)' : html }))
    if (fixture === 'complete') console.log(JSON.stringify({ renderer: name, semanticTags: Object.fromEntries(['h1', 'strong', 'code', 'ul', 'blockquote', 'table'].map(tag => [tag, html.includes(`<${tag}`)])) }))
  }
  const bundled = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';${name === 'react-markdown' ? "import C from 'react-markdown';import gfm from 'remark-gfm';" : "import {Streamdown as C} from 'streamdown';"}createRoot(document.getElementById('root')).render(React.createElement(C,${name === 'react-markdown' ? '{remarkPlugins:[gfm]}' : '{}'},'# Hello'))`, resolveDir: process.cwd() }, bundle: true, minify: true, write: false, platform: 'browser', format: 'esm', define: { 'process.env.NODE_ENV': '"production"' } })
  if (bundled) console.log(JSON.stringify({ renderer: name, bundleBytes: bundled.outputFiles[0].contents.length, gzipBytes: gzipSync(bundled.outputFiles[0].contents).length, includesReactRuntime: true }))
}
```
