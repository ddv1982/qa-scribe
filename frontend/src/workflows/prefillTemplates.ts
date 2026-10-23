import { stripHtml } from '../editor/editorHtml'
import { escapeHtml } from '../editor/htmlUtils'
import { creationSections } from '../app/creationIntent'

export function renderPrefilledTestware(_title: string, body: string): string {
  const note = stripHtml(body)
  return `${note ? `<h3>Source note</h3><p>${escapeHtml(note)}</p>` : ''}${creationSections.testware.map((section) => `<h3>${section}</h3><p></p>`).join('')}`
}

export function renderPrefilledFinding(body: string): string {
  const note = stripHtml(body).slice(0, 4000)
  return creationSections.finding.map((section) => `<h3>${section}</h3><p>${section === 'Evidence' ? escapeHtml(note) : ''}</p>`).join('')
}
