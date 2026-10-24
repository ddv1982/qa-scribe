import { stripHtml } from '../editor/editorHtml'
import { escapeHtml } from '../editor/htmlUtils'
import { richEditorDocumentToHtml } from '../editor/editorDocument'
import { creationStarter, type CreationFormat } from '../app/creationFormats'

export function renderPrefilledTestware(_title: string, body: string, outputFormat: import('../tauri').TestwareOutputFormat = 'qa_cases'): string {
  const note = stripHtml(body)
  return `${note ? `<h3>Source note</h3><p>${escapeHtml(note)}</p>` : ''}${richEditorDocumentToHtml(creationStarter({ kind: 'testware', outputFormat }))}`
}

export function renderPrefilledFinding(body: string, template: Extract<CreationFormat, { kind: 'finding' }>['template'] = 'structured'): string {
  const note = escapeHtml(stripHtml(body).slice(0, 4000))
  if (template === 'blank') return note ? `<p>${note}</p>` : ''
  return richEditorDocumentToHtml(creationStarter({ kind: 'finding', template })).replace('<h3>Evidence</h3><p></p>', `<h3>Evidence</h3><p>${note}</p>`)
}
