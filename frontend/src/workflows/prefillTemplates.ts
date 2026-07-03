import { stripHtml } from '../editor/editorHtml'
import { escapeHtml } from '../editor/htmlUtils'

export function renderPrefilledTestware(title: string, body: string): string {
  const note = stripHtml(body) || 'Add source note detail.'
  return [
    `<h2>${escapeHtml(title)} Test Cases</h2>`,
    '<h3>Source note</h3>',
    `<p>${escapeHtml(note)}</p>`,
    '<h3>Test cases</h3>',
    '<ol>',
    '<li><p><strong>Scenario:</strong> Describe the behavior under test.</p><p><strong>Steps:</strong> Add concise steps.</p><p><strong>Expected result:</strong> Describe the expected outcome.</p></li>',
    '</ol>',
  ].join('')
}

export function renderPrefilledFinding(body: string): string {
  const note = stripHtml(body).slice(0, 4000) || 'Describe the finding.'
  return [
    '<h2>Finding detail</h2>',
    `<p>${escapeHtml(note)}</p>`,
    '<h3>Reproduction</h3>',
    '<ol><li>Add the first reproduction step.</li><li>Add the expected and actual result.</li></ol>',
    '<h3>Impact</h3>',
    '<p>Describe user impact and risk.</p>',
  ].join('')
}
