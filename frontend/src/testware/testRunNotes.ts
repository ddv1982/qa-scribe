import type { RichEditorDocument } from '../editor/editorDocument'
import type { TestCaseNotes } from '../tauri'

export function notesText(document: RichEditorDocument): string {
  const visit = (node: RichEditorDocument['doc']): string => {
    if (node.type === 'horizontalRule') return '---\n'
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
