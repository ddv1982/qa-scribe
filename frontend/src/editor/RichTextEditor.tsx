import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { Bold, ImageIcon, Italic, Link2, List, ListChecks, type LucideIcon } from 'lucide-react'
import {
  createManagedAttachmentPreviewCache,
  hydrateManagedAttachmentPreviews,
  isSafeEditorLinkUrl,
  managedAttachmentProtocol,
  type ManagedAttachmentPreviewCache,
} from './editorHtml'
import { richTextEditorExtensions } from './editorExtensions'
import { normalizeRichEditorDocument, richEditorDocumentsEqual, type RichEditorDocument } from './editorDocument'
import {
  notifyRichEditorRegistry,
  registerRichEditor,
  setActiveRichEditor,
  useRichEditorController,
  type RichEditorImageInserter,
  type RichEditorImageUpload,
} from './richEditorRegistry'

export type { RichEditorImageInserter, RichEditorImageUpload } from './richEditorRegistry'

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
  const blockValue = editor?.isActive('heading', { level: 2 }) ? 'h2' : editor?.isActive('heading', { level: 3 }) ? 'h3' : 'p'
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
        <option value="p">Paragraph</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <span className="toolbar-divider" aria-hidden="true" />
      <ToolbarButton label="Bold" icon={Bold} active={editor?.isActive('bold')} disabled={disabled} controlsId={editorId} command={() => editor?.chain().focus().toggleBold().run()} />
      <ToolbarButton label="Italic" icon={Italic} active={editor?.isActive('italic')} disabled={disabled} controlsId={editorId} command={() => editor?.chain().focus().toggleItalic().run()} />
      <ToolbarButton
        label="Bulleted list"
        icon={List}
        active={editor?.isActive('bulletList')}
        disabled={disabled}
        controlsId={editorId}
        command={() => editor?.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="Checklist"
        icon={ListChecks}
        active={editor?.isActive('taskList')}
        disabled={disabled}
        controlsId={editorId}
        command={() => editor?.chain().focus().toggleTaskList().run()}
      />
      <ToolbarButton label="Link" icon={Link2} active={editor?.isActive('link')} disabled={disabled} controlsId={editorId} command={openLinkEditor} />
      <ToolbarButton label="Upload image" icon={ImageIcon} command={requestImageUpload} disabled={disabled || !onUploadImage} controlsId={editorId} />
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
          <button className="secondary-button link-editor-apply" type="submit" aria-label="Apply link">
            Apply
          </button>
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

type RichTextEditorProps = {
  value: RichEditorDocument
  onChange?: (value: RichEditorDocument) => void
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
  const previewLoadRef = useRef(0)
  const previewRetryTimerRef = useRef<number | null>(null)
  const [previewCache] = useState(() => createManagedAttachmentPreviewCache())
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(
    () => () => {
      previewLoadRef.current += 1
      if (previewRetryTimerRef.current !== null) window.clearTimeout(previewRetryTimerRef.current)
      previewCache.clear()
    },
    [previewCache],
  )

  const editor = useEditor(
    {
      extensions: richTextEditorExtensions(placeholder),
      content: normalizeRichEditorDocument(value).doc,
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: {
        attributes: editorAttributes({ editorId, className, ariaLabel, placeholder, readOnly }),
        handleDOMEvents: {
          focus: () => {
            if (editorId) {
              setActiveRichEditor(editorId)
            }
            return false
          },
        },
      },
      onUpdate: ({ editor: updatedEditor }) => {
        const nextValue = normalizeRichEditorDocument({ schemaVersion: 1, doc: updatedEditor.getJSON() })
        onChangeRef.current?.(nextValue)
        queueManagedPreviewHydration(updatedEditor, previewLoadRef, previewRetryTimerRef, previewCache)
        notifyRichEditorRegistry()
      },
      onSelectionUpdate: () => notifyRichEditorRegistry(),
      onTransaction: () => notifyRichEditorRegistry(),
    },
    // TipTap updates changed options in place when this list is empty. Recreating
    // the editor for presentation-only props leaves the previous instance briefly
    // observable by React effects after TipTap has destroyed its view.
    [],
  )

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const normalizedValue = normalizeRichEditorDocument(value)
    const currentValue = normalizeRichEditorDocument({ schemaVersion: 1, doc: editor.getJSON() })
    if (!richEditorDocumentsEqual(currentValue, normalizedValue)) {
      editor.commands.setContent(normalizedValue.doc, { emitUpdate: false })
    }
    queueManagedPreviewHydration(editor, previewLoadRef, previewRetryTimerRef, previewCache)
  }, [editor, previewCache, value])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !editorId) return
    const insertImage: RichEditorImageInserter = (attachmentId, filename, previewSrc) => {
      if (editor.isDestroyed) return false
      const source = `${managedAttachmentProtocol}${attachmentId}`
      if (previewSrc) previewCache.seed(attachmentId, previewSrc)
      const inserted = editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .insertContent({
          type: 'image',
          attrs: {
            src: source,
            attachmentId,
            alt: filename,
          },
        })
        .run()

      if (inserted && previewSrc) {
        queueManagedPreviewHydration(editor, previewLoadRef, previewRetryTimerRef, previewCache)
      }
      return inserted
    }

    return registerRichEditor(editorId, { editor, insertImage, readOnly })
  }, [editor, editorId, previewCache, readOnly])

  if (!editor) {
    return <div id={editorId} className={['rich-editor', className].filter(Boolean).join(' ')} role="textbox" aria-label={ariaLabel} aria-multiline="true" data-placeholder={placeholder} />
  }

  return <EditorContent editor={editor} />
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

function setBlockStyle(editor: Editor | null, value: string) {
  if (!editor) return
  if (value === 'h2') {
    editor.chain().focus().toggleHeading({ level: 2 }).run()
    return
  }
  if (value === 'h3') {
    editor.chain().focus().toggleHeading({ level: 3 }).run()
    return
  }
  editor.chain().focus().setParagraph().run()
}

function editorAttributes({
  editorId,
  className,
  ariaLabel,
  placeholder,
  readOnly,
}: {
  editorId?: string
  className?: string
  ariaLabel: string
  placeholder: string
  readOnly: boolean
}) {
  const attributes: Record<string, string> = {
    class: ['rich-editor', className].filter(Boolean).join(' '),
    role: 'textbox',
    'aria-label': ariaLabel,
    'aria-multiline': 'true',
    'data-placeholder': placeholder,
    spellcheck: String(!readOnly),
  }

  if (editorId) attributes.id = editorId
  if (readOnly) attributes['aria-readonly'] = 'true'
  return attributes
}

function queueManagedPreviewHydration(
  editor: Editor,
  previewLoadRef: { current: number },
  previewRetryTimerRef: { current: number | null },
  previewCache: ManagedAttachmentPreviewCache,
) {
  if (editor.isDestroyed) return
  const loadId = previewLoadRef.current + 1
  previewLoadRef.current = loadId
  if (previewRetryTimerRef.current !== null) {
    window.clearTimeout(previewRetryTimerRef.current)
    previewRetryTimerRef.current = null
  }
  window.queueMicrotask(() => {
    if (editor.isDestroyed || previewLoadRef.current !== loadId) return
    void hydrateManagedAttachmentPreviews(
      editor.view.dom,
      () => !editor.isDestroyed && previewLoadRef.current === loadId,
      previewCache,
    ).then((retryAfterMs) => {
      if (retryAfterMs === null || editor.isDestroyed || previewLoadRef.current !== loadId) return
      previewRetryTimerRef.current = window.setTimeout(() => {
        previewRetryTimerRef.current = null
        if (editor.isDestroyed || previewLoadRef.current !== loadId) return
        queueManagedPreviewHydration(editor, previewLoadRef, previewRetryTimerRef, previewCache)
      }, retryAfterMs)
    })
  })
}
