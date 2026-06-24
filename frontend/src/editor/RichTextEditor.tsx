import { useEffect, useRef, type ChangeEvent } from 'react'
import { Bold, ImageIcon, Italic, Link2, List, ListChecks, type LucideIcon } from 'lucide-react'
import {
  hydrateManagedAttachmentPreviews,
  insertEditorHtml,
  isSafeEditorLinkUrl,
  normalizeEditorHtml,
  restoreSelection,
  serializeEditorHtml,
  selectedRangeWithin,
} from './editorHtml'

let activeRichEditor: HTMLElement | null = null

export type RichEditorImageUpload = {
  file: File
  editor: HTMLElement
  insertionRange: Range | null
}

type FormatToolbarProps = {
  editorId?: string
  onUploadImage?: (input: RichEditorImageUpload) => void | Promise<void>
}

export function FormatToolbar({ editorId, onUploadImage }: FormatToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadContextRef = useRef<Omit<RichEditorImageUpload, 'file'> | null>(null)

  function requestImageUpload() {
    const editor = toolbarEditor(editorId)
    if (!editor || !onUploadImage) return
    uploadContextRef.current = {
      editor,
      insertionRange: selectedRangeWithin(editor) ?? rangeAtEnd(editor),
    }
    fileInputRef.current?.click()
  }

  function handleImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    const context = uploadContextRef.current
    uploadContextRef.current = null
    if (!file || !context || !onUploadImage) return
    void onUploadImage({ ...context, file })
  }

  return (
    <div className="format-toolbar" aria-label="Formatting toolbar">
      <select
        defaultValue="p"
        aria-label="Block style"
        onChange={(event) => {
          formatBlock(event.target.value, editorId)
          event.target.value = 'p'
        }}
      >
        <option value="p">Paragraph</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <span className="toolbar-divider" />
      <ToolbarButton label="Bold" icon={Bold} command={() => applyEditorCommand(() => document.execCommand('bold'), editorId)} />
      <ToolbarButton label="Italic" icon={Italic} command={() => applyEditorCommand(() => document.execCommand('italic'), editorId)} />
      <ToolbarButton label="Bulleted list" icon={List} command={() => applyEditorCommand(() => document.execCommand('insertUnorderedList'), editorId)} />
      <ToolbarButton label="Checklist" icon={ListChecks} command={() => applyEditorCommand(() => insertEditorHtml('<p><input type="checkbox" /> Task</p>'), editorId)} />
      <ToolbarButton label="Link" icon={Link2} command={() => insertLink(editorId)} />
      <ToolbarButton label="Upload image" icon={ImageIcon} command={requestImageUpload} disabled={!onUploadImage} />
      <input ref={fileInputRef} className="toolbar-file-input" type="file" accept="image/*" aria-label="Upload image file" onChange={handleImageSelected} />
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
  editorId?: string
}

export function RichTextEditor({
  value,
  onChange,
  ariaLabel = 'Note body',
  placeholder = 'Write testing notes...',
  readOnly = false,
  className,
  editorId,
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
      id={editorId}
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

function ToolbarButton({ label, icon: Icon, command, disabled = false }: { label: string; icon: LucideIcon; command: () => void; disabled?: boolean }) {
  return (
    <button className="toolbar-button" type="button" aria-label={label} title={label} disabled={disabled} onClick={command}>
      <Icon size={16} />
    </button>
  )
}

function formatBlock(tag: string, editorId?: string) {
  applyEditorCommand(() => document.execCommand('formatBlock', false, tag), editorId)
}

function insertLink(editorId?: string) {
  const url = window.prompt('Link URL')
  if (!url) return
  if (!isSafeEditorLinkUrl(url)) {
    window.alert('Use an http, https, or mailto link.')
    return
  }
  applyEditorCommand(() => document.execCommand('createLink', false, url), editorId)
}

function applyEditorCommand(command: () => void, editorId?: string) {
  const editor = toolbarEditor(editorId)
  if (editor) {
    const range = selectedRangeWithin(editor) ?? rangeAtEnd(editor)
    restoreSelection(range)
    editor.focus({ preventScroll: true })
  }
  command()
  editor?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatSetBlockTextDirection' }))
}

function toolbarEditor(editorId?: string): HTMLElement | null {
  if (editorId) {
    const editor = document.getElementById(editorId)
    if (editor?.classList.contains('rich-editor')) return editor
  }
  return selectedEditor() ?? activeRichEditor
}

function selectedEditor(): HTMLElement | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const node = selection.getRangeAt(0).commonAncestorContainer
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return element?.closest<HTMLElement>('.rich-editor') ?? null
}

function rangeAtEnd(editor: HTMLElement): Range {
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  return range
}
