import { richEditorDocumentFromHtml, richEditorDocumentToHtml } from '../editor/editorDocument'
import { managedAttachmentIdFromImage } from '../editor/htmlUtils'

// Display-only: the original provider response still owns persistence. A single
// HTML block keeps literal Markdown text out of the Markdown inline parser.
export function testwarePreviewHtml(value: string): string {
  // Template contents are inert, including image elements. Remove network
  // sources before entering the existing rich-document normalization path.
  const source = document.createElement('template')
  source.innerHTML = value
  source.content.querySelectorAll('img').forEach((image) => {
    if (!managedAttachmentIdFromImage(image)) image.replaceWith(document.createTextNode(`Image: ${image.alt || 'Attached image'}`))
  })
  // A real wrapper also prevents legacy escaped-HTML repair from turning text
  // such as &lt;img ...&gt; into a resource during this transient preview.
  const normalized = richEditorDocumentToHtml(richEditorDocumentFromHtml(`<p></p>${source.innerHTML}`))
  const template = document.createElement('template')
  template.innerHTML = normalized
  if (template.content.firstElementChild?.outerHTML === '<p></p>') template.content.firstElementChild.remove()
  const container = template.content
  container.querySelectorAll('img').forEach((image) => {
    const id = managedAttachmentIdFromImage(image)
    const alt = image.alt || 'Attached image'
    if (!id) {
      image.replaceWith(document.createTextNode(`Image: ${alt}`))
      return
    }
    const evidence = document.createElement('qa-evidence')
    evidence.setAttribute('attachment-id', id)
    evidence.setAttribute('alt', alt)
    image.replaceWith(evidence)
  })
  container.querySelectorAll('li[data-type="taskItem"]').forEach((item) => {
    item.className = 'task-list-item'
  })
  container.querySelectorAll('input').forEach((input) => { input.disabled = true })
  return `<div>${template.innerHTML.replace(/\n/g, '&#10;')}</div>`
}
