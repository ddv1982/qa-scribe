import type { RichEditorDocument } from '../editor/editorDocument'
import { panelKind, panelLabels } from '../editor/editorPanels'
import type { TestCaseNotes } from '../tauri'

export function notesText(document: RichEditorDocument): string {
  const visit = (node: RichEditorDocument['doc']): string => {
    if (node.type === 'horizontalRule') return '---\n'
    // A panel names its kind on a line of its own, as in Rust's `test_run_notes::summarize`.
    if (node.type === 'panel') return `${panelLabels[panelKind(node.attrs?.kind)]}:\n${(node.content ?? []).map(visit).join('')}`
    // One line per row, its cells separated by ` | `, as in Rust's `test_run_notes::summarize`.
    if (node.type === 'tableRow') return (node.content ?? []).map((cell) => visit(cell).split(/\s+/).filter(Boolean).join(' ')).join(' | ').trimEnd() + '\n'
    const text = (node.text ?? '') + (node.content ?? []).map(visit).join('')
    return ['heading', 'paragraph', 'codeBlock', 'hardBreak'].includes(node.type ?? '') ? text + '\n' : text
  }
  return visit(document.doc).trim()
}

export function resultNotesLines(notes: TestCaseNotes): string[] {
  return [
    ...(notes.text ? ['  Result notes:', ...notes.text.split('\n').map(line => `    ${line}`)] : []),
    ...(notes.imageCount ? [`  Evidence: ${notes.imageCount} ${notes.imageCount === 1 ? 'image' : 'images'}`] : []),
  ]
}
