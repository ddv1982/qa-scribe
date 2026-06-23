import { useEffect, useRef } from 'react'
import { Bold, ImageIcon, Italic, Link2, List, ListChecks, type LucideIcon } from 'lucide-react'
import { hydrateManagedAttachmentPreviews, insertEditorHtml, normalizeEditorHtml, serializeEditorHtml } from './editorHtml'

export function FormatToolbar() {
  return (
    <div className="format-toolbar" aria-label="Formatting toolbar">
      <select
        defaultValue="p"
        aria-label="Block style"
        onChange={(event) => {
          formatBlock(event.target.value)
          event.target.value = 'p'
        }}
      >
        <option value="p">Paragraph</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <span className="toolbar-divider" />
      <ToolbarButton label="Bold" icon={Bold} command={() => document.execCommand('bold')} />
      <ToolbarButton label="Italic" icon={Italic} command={() => document.execCommand('italic')} />
      <ToolbarButton label="Bulleted list" icon={List} command={() => document.execCommand('insertUnorderedList')} />
      <ToolbarButton label="Checklist" icon={ListChecks} command={() => insertEditorHtml('<p><input type="checkbox" /> Task</p>')} />
      <ToolbarButton label="Link" icon={Link2} command={insertLink} />
      <ToolbarButton label="Image" icon={ImageIcon} command={insertImage} />
    </div>
  )
}

export function RichTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const previewLoadRef = useRef(0)

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const normalizedValue = normalizeEditorHtml(value)
    if (serializeEditorHtml(editor) !== normalizedValue) {
      editor.innerHTML = normalizedValue
    }
    const loadId = previewLoadRef.current + 1
    previewLoadRef.current = loadId
    void hydrateManagedAttachmentPreviews(editor, () => previewLoadRef.current === loadId)
  }, [value])

  return (
    <div
      ref={editorRef}
      className="rich-editor"
      contentEditable
      role="textbox"
      aria-label="Note body"
      spellCheck
      onInput={(event) => onChange(serializeEditorHtml(event.currentTarget))}
      suppressContentEditableWarning
    />
  )
}

function ToolbarButton({ label, icon: Icon, command }: { label: string; icon: LucideIcon; command: () => void }) {
  return (
    <button className="toolbar-button" type="button" aria-label={label} title={label} onClick={command}>
      <Icon size={16} />
    </button>
  )
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
}

function formatBlock(tag: string) {
  document.execCommand('formatBlock', false, tag)
}

function insertImage() {
  const url = window.prompt('Image URL')
  if (!url) return
  insertEditorHtml(`<img src="${escapeAttribute(url)}" alt="" />`)
}

function insertLink() {
  const url = window.prompt('Link URL')
  if (!url) return
  document.execCommand('createLink', false, url)
}
