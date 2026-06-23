import { useEffect, useRef } from 'react'
import { Bold, ImageIcon, Italic, Link2, List, ListChecks, type LucideIcon } from 'lucide-react'
import {
  hydrateManagedAttachmentPreviews,
  insertEditorHtml,
  isSafeEditorImageSource,
  isSafeEditorLinkUrl,
  normalizeEditorHtml,
  serializeEditorHtml,
} from './editorHtml'

let activeRichEditor: HTMLElement | null = null

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
      <ToolbarButton label="Bold" icon={Bold} command={() => applyEditorCommand(() => document.execCommand('bold'))} />
      <ToolbarButton label="Italic" icon={Italic} command={() => applyEditorCommand(() => document.execCommand('italic'))} />
      <ToolbarButton label="Bulleted list" icon={List} command={() => applyEditorCommand(() => document.execCommand('insertUnorderedList'))} />
      <ToolbarButton label="Checklist" icon={ListChecks} command={() => applyEditorCommand(() => insertEditorHtml('<p><input type="checkbox" /> Task</p>'))} />
      <ToolbarButton label="Link" icon={Link2} command={insertLink} />
      <ToolbarButton label="Image" icon={ImageIcon} command={insertImage} />
    </div>
  )
}

type RichTextEditorProps = {
  value: string
  onChange?: (value: string) => void
  ariaLabel?: string
  placeholder?: string
  readOnly?: boolean
  className?: string
}

export function RichTextEditor({
  value,
  onChange,
  ariaLabel = 'Note body',
  placeholder = 'Write testing notes...',
  readOnly = false,
  className,
}: RichTextEditorProps) {
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
      className={['rich-editor', className].filter(Boolean).join(' ')}
      contentEditable={!readOnly}
      role="textbox"
      aria-label={ariaLabel}
      aria-readonly={readOnly || undefined}
      data-placeholder={placeholder}
      spellCheck={!readOnly}
      onFocus={(event) => {
        activeRichEditor = event.currentTarget
      }}
      onInput={(event) => {
        if (!readOnly) onChange?.(serializeEditorHtml(event.currentTarget))
      }}
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
  applyEditorCommand(() => document.execCommand('formatBlock', false, tag))
}

function insertImage() {
  const url = window.prompt('Image URL')
  if (!url) return
  if (!isSafeEditorImageSource(url)) {
    window.alert('Use an http, https, data:image, or managed attachment image URL.')
    return
  }
  applyEditorCommand(() => insertEditorHtml(`<img src="${escapeAttribute(url)}" alt="" />`))
}

function insertLink() {
  const url = window.prompt('Link URL')
  if (!url) return
  if (!isSafeEditorLinkUrl(url)) {
    window.alert('Use an http, https, or mailto link.')
    return
  }
  applyEditorCommand(() => document.execCommand('createLink', false, url))
}

function applyEditorCommand(command: () => void) {
  const editor = selectedEditor() ?? activeRichEditor
  command()
  editor?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatSetBlockTextDirection' }))
}

function selectedEditor(): HTMLElement | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const node = selection.getRangeAt(0).commonAncestorContainer
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return element?.closest<HTMLElement>('.rich-editor') ?? null
}
