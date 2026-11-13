import { describe, expect, it } from 'vitest'
import { creationStarter } from '../app/creationFormats'
import { richEditorDocumentToHtml } from '../editor/editorDocument'
import { findingFromTestCase } from './fromTestCase'

const bodyJson = JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: [
  { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Pay with a gift card' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Steps:', marks: [{ type: 'bold' }] }] },
  { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pay with <b>card</b>' }] }] }] },
] } })

describe('findingFromTestCase', () => {
  it('puts the case content without its heading under Steps to reproduce and the remark under Actual result', () => {
    const html = richEditorDocumentToHtml(findingFromTestCase({ bodyJson, remark: 'Card <script>declined</script>' }))
    expect(html).toBe([
      '<h3>Environment</h3><p></p>',
      '<h3>Steps to reproduce</h3><p><strong>Steps:</strong></p><ol><li><p>Pay with &lt;b&gt;card&lt;/b&gt;</p></li></ol>',
      '<h3>Expected result</h3><p></p>',
      '<h3>Actual result</h3><p>Card &lt;script&gt;declined&lt;/script&gt;</p>',
      '<h3>Evidence</h3><p></p>',
      '<h3>Impact</h3><p></p>',
    ].join(''))
    expect(html).not.toContain('Pay with a gift card')
  })

  it('is the structured starter when the case has no content and no remark', () => {
    const empty = JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: [] } })
    expect(richEditorDocumentToHtml(findingFromTestCase({ bodyJson: empty, remark: null })))
      .toBe(richEditorDocumentToHtml(creationStarter({ kind: 'finding', template: 'structured' })))
  })
})
