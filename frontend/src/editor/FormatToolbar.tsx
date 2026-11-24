import { ActionButton } from '../components/ActionButton'
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react'
import type { Editor } from '@tiptap/react'
import { selectedRect } from '@tiptap/pm/tables'
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Code,
  Columns2,
  Grid2x2X,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Rows2,
  SeparatorHorizontal,
  Strikethrough,
  Table,
  type LucideIcon,
} from 'lucide-react'
import { blockStyles, currentBlockStyle, setBlockStyle } from './blockStyles'
import { isSafeEditorLinkUrl } from './editorHtml'
import { registerImageUploadRequest, useRichEditorController, type RichEditorImageInserter, type RichEditorImageUpload } from './richEditorRegistry'

type FormatToolbarProps = {
  editorId?: string
  onUploadImage?: (input: RichEditorImageUpload) => void | Promise<void>
}

type EditorSelection = Editor['state']['selection']

export function FormatToolbar({ editorId, onUploadImage }: FormatToolbarProps) {
  const generatedId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadInserterRef = useRef<RichEditorImageInserter | null>(null)
  const linkInputRef = useRef<HTMLInputElement | null>(null)
  const savedSelectionRef = useRef<EditorSelection | null>(null)
  const controller = useRichEditorController(editorId)
  const editor = controller?.editor ?? null
  const disabled = !editor || Boolean(controller?.readOnly)
  const blockValue = currentBlockStyle(editor)
  const linkErrorId = `${editorId ?? generatedId}-link-error`

  function saveEditorSelection() {
    if (!editor || editor.state.selection.empty) {
      savedSelectionRef.current = null
      return
    }
    savedSelectionRef.current = editor.state.selection
  }

  function restoreSavedSelection() {
    const selection = savedSelectionRef.current
    savedSelectionRef.current = null
    if (!editor || !selection) return

    try {
      editor.view.dispatch(editor.state.tr.setSelection(selection))
    } catch {
      // The document changed after the selection was captured; let TipTap use its current selection.
    }
  }

  function applyBlockStyle(value: string) {
    restoreSavedSelection()
    setBlockStyle(editor, value)
  }

  // Inline link editor. `window.prompt`/`window.alert` are no-ops on macOS wry
  // (WKWebView returns null without a WKUIDelegate), so we edit links in an
  // inline popover instead. Behaviour parity with the old prompt flow: the
  // current href is prefilled, an empty submit removes the link, and an unsafe
  // scheme is rejected with an inline message.
  const [linkPopover, setLinkPopover] = useState<{ value: string; error: string | null } | null>(null)

  function openLinkEditor() {
    if (!editor) return
    saveEditorSelection()
    const currentHref: unknown = editor.getAttributes('link').href
    setLinkPopover({ value: typeof currentHref === 'string' ? currentHref : '', error: null })
  }

  function closeLinkEditor() {
    savedSelectionRef.current = null
    setLinkPopover(null)
    editor?.chain().focus().run()
  }

  function submitLinkEditor(event: FormEvent) {
    event.preventDefault()
    if (!editor || !linkPopover) return
    const trimmedUrl = linkPopover.value.trim()
    if (!trimmedUrl) {
      restoreSavedSelection()
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      setLinkPopover(null)
      return
    }
    if (!isSafeEditorLinkUrl(trimmedUrl)) {
      setLinkPopover({ value: linkPopover.value, error: 'Use an http, https, or mailto link.' })
      return
    }
    restoreSavedSelection()
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmedUrl }).run()
    setLinkPopover(null)
  }

  useEffect(() => {
    if (linkPopover) linkInputRef.current?.focus()
  }, [linkPopover])

  function requestImageUpload() {
    if (!controller || !onUploadImage) return
    uploadInserterRef.current = controller.insertImage
    controller.editor.chain().focus().run()
    fileInputRef.current?.click()
  }

  const requestImageUploadRef = useRef(requestImageUpload)
  useEffect(() => {
    requestImageUploadRef.current = requestImageUpload
  })
  const canUpload = Boolean(editorId && onUploadImage && !disabled)
  useEffect(() => {
    if (!editorId || !canUpload) return
    return registerImageUploadRequest(editorId, () => requestImageUploadRef.current())
  }, [canUpload, editorId])

  function handleImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    const insertImage = uploadInserterRef.current
    uploadInserterRef.current = null
    if (!file || !insertImage || !onUploadImage || !editorId) return
    void onUploadImage({ editorId, file, insertImage })
  }

  return (
    <div className="format-toolbar" role="toolbar" aria-label="Formatting toolbar">
      <select
        value={blockValue}
        aria-label="Block style"
        aria-controls={editorId}
        disabled={disabled}
        onMouseDown={saveEditorSelection}
        onFocus={saveEditorSelection}
        onChange={(event) => {
          applyBlockStyle(event.target.value)
        }}
      >
        {blockStyles.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <span className="toolbar-divider" aria-hidden="true" />
      <ToolbarButton label="Bold" icon={Bold} active={editor?.isActive('bold')} disabled={disabled} controlsId={editorId} command={() => editor?.chain().focus().toggleBold().run()} />
      <ToolbarButton label="Italic" icon={Italic} active={editor?.isActive('italic')} disabled={disabled} controlsId={editorId} command={() => editor?.chain().focus().toggleItalic().run()} />
      <ToolbarButton
        label="Strikethrough"
        icon={Strikethrough}
        active={editor?.isActive('strike')}
        disabled={disabled}
        controlsId={editorId}
        command={() => editor?.chain().focus().toggleStrike().run()}
      />
      <ToolbarButton label="Inline code" icon={Code} active={editor?.isActive('code')} disabled={disabled} controlsId={editorId} command={() => editor?.chain().focus().toggleCode().run()} />
      <ToolbarButton
        label="Bulleted list"
        icon={List}
        active={editor?.isActive('bulletList')}
        disabled={disabled}
        controlsId={editorId}
        command={() => editor?.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="Numbered list"
        icon={ListOrdered}
        active={editor?.isActive('orderedList')}
        disabled={disabled}
        controlsId={editorId}
        command={() => editor?.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        label="Checklist"
        icon={ListChecks}
        active={editor?.isActive('taskList')}
        disabled={disabled}
        controlsId={editorId}
        command={() => editor?.chain().focus().toggleTaskList().run()}
      />
      <ToolbarButton
        label="Divider"
        icon={SeparatorHorizontal}
        // A divider has no place in a cell; inserted there it would split the table.
        disabled={disabled || Boolean(editor?.isActive('table'))}
        controlsId={editorId}
        command={() => editor?.chain().focus().setHorizontalRule().run()}
      />
      <ToolbarButton
        label="Insert table"
        icon={Table}
        // A cell holds one paragraph, so tables do not nest.
        disabled={disabled || Boolean(editor?.isActive('table'))}
        controlsId={editorId}
        command={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      />
      <ToolbarButton label="Link" icon={Link2} active={editor?.isActive('link')} disabled={disabled} controlsId={editorId} command={openLinkEditor} />
      <ToolbarButton label="Upload image" icon={ImageIcon} command={requestImageUpload} disabled={disabled || !onUploadImage} controlsId={editorId} />
      {editor && !disabled && editor.isActive('table') ? <TableControls editor={editor} controlsId={editorId} /> : null}
      <input ref={fileInputRef} className="toolbar-file-input" type="file" accept="image/*" aria-label="Upload image file" onChange={handleImageSelected} />
      {linkPopover ? (
        <form className="link-editor-popover" aria-label="Edit link" onSubmit={submitLinkEditor}>
          <input
            ref={linkInputRef}
            className="link-editor-input"
            type="text"
            inputMode="url"
            value={linkPopover.value}
            placeholder="https://example.com — leave blank to remove"
            aria-label="Link URL"
            aria-invalid={linkPopover.error ? true : undefined}
            aria-describedby={linkPopover.error ? linkErrorId : undefined}
            onChange={(event) => setLinkPopover({ value: event.target.value, error: null })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeLinkEditor()
              }
            }}
          />
          <ActionButton variant="secondary" className="link-editor-apply" type="submit" aria-label="Apply link">
            Apply
          </ActionButton>
          {linkPopover.error ? (
            <p id={linkErrorId} className="link-editor-error" role="alert">
              {linkPopover.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}

type TableCommand = 'addRowBefore' | 'addRowAfter' | 'addColumnBefore' | 'addColumnAfter' | 'deleteRow' | 'deleteColumn' | 'deleteTable'

const tableControls: { label: string; icon: LucideIcon; command: TableCommand }[] = [
  { label: 'Add row above', icon: BetweenHorizontalStart, command: 'addRowBefore' },
  { label: 'Add row below', icon: BetweenHorizontalEnd, command: 'addRowAfter' },
  { label: 'Add column left', icon: BetweenVerticalStart, command: 'addColumnBefore' },
  { label: 'Add column right', icon: BetweenVerticalEnd, command: 'addColumnAfter' },
  { label: 'Delete row', icon: Rows2, command: 'deleteRow' },
  { label: 'Delete column', icon: Columns2, command: 'deleteColumn' },
  { label: 'Delete table', icon: Grid2x2X, command: 'deleteTable' },
]

/**
 * Row, column and table commands, shown while the cursor is in a table. Delete row and Delete
 * column do nothing when the selection covers every row or column, so they are disabled then.
 */
function TableControls({ editor, controlsId }: { editor: Editor; controlsId?: string }) {
  const rect = selectedRect(editor.state)
  const unavailable: Partial<Record<TableCommand, boolean>> = {
    deleteRow: rect.top === 0 && rect.bottom === rect.map.height,
    deleteColumn: rect.left === 0 && rect.right === rect.map.width,
  }
  return (
    <div className="toolbar-group" role="group" aria-label="Table">
      <span className="toolbar-divider" aria-hidden="true" />
      {tableControls.map(({ label, icon, command }) => (
        <ToolbarButton key={command} label={label} icon={icon} controlsId={controlsId} disabled={unavailable[command]} command={() => editor.chain().focus()[command]().run()} />
      ))}
    </div>
  )
}

function ToolbarButton({
  label,
  icon: Icon,
  command,
  active = false,
  disabled = false,
  controlsId,
}: {
  label: string
  icon: LucideIcon
  command: () => void
  active?: boolean
  disabled?: boolean
  controlsId?: string
}) {
  function preserveEditorSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
  }

  return (
    <button
      className="toolbar-button"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={active}
      aria-controls={controlsId}
      onMouseDown={preserveEditorSelection}
      onClick={command}
    >
      <Icon size={16} />
    </button>
  )
}
