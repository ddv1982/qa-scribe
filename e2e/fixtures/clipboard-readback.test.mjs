import assert from 'node:assert/strict'
import test from 'node:test'
import { assertClipboardHtml } from './clipboard-readback.mjs'

const fragment = '<h2>UX4 Alpha</h2><p><strong>Note</strong> exact source.</p>'
const macPayload = '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head><body><h2>UX4 Alpha</h2><p><strong>Note</strong> exact source.</p></body></html>'

test('matches the full observed macOS HTML clipboard document and bare Linux fragment', () => {
  assertClipboardHtml(macPayload, fragment, 'darwin')
  assertClipboardHtml(fragment, fragment, 'linux')
})

test('rejects wrong source, missing formatting, extra content and missing macOS envelope', () => {
  for (const actual of [
    macPayload.replace('UX4 Alpha', 'UX4 Beta'),
    macPayload.replace('<strong>Note</strong>', 'Note'),
    macPayload.replace('</body>', '<p>Unexpected</p></body>'),
    fragment,
  ]) assert.throws(() => assertClipboardHtml(actual, fragment, 'darwin'), assert.AssertionError)
  assert.throws(() => assertClipboardHtml(macPayload, fragment, 'linux'), assert.AssertionError)
  assert.throws(() => assertClipboardHtml('<h2>UX4 Beta</h2><p><strong>Note</strong> exact source.</p>', fragment, 'linux'), assert.AssertionError)
})
