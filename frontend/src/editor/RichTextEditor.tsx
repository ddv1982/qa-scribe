import { useEffect, useRef, type ChangeEvent } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Bold, ImageIcon, Italic, Link2, List, ListChecks, type LucideIcon } from 'lucide-react'
import { isSafeEditorLinkUrl, managedAttachmentProtocol, normalizeEditorHtml, hydrateManagedAttachmentPreviews } from './editorHtml'
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

const ManagedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('src'),
        renderHTML: (attributes) => {
          const attachmentId = stringAttribute(attributes.attachmentId)
          const source = attachmentId ? `${managedAttachmentProtocol}${attachmentId}` : stringAttribute(attributes.src)
          return source ? { src: source } : {}
        },
      },
      attachmentId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-attachment-id') || managedAttachmentIdFromSource(element.getAttribute('src') ?? ''),
        renderHTML: (attributes) => {
          const attachmentId = stringAttribute(attributes.attachmentId)
          return attachmentId ? { 'data-attachment-id': attachmentId } : {}
        },
      },
      alt: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('alt'),
        renderHTML: (attributes) => {
          const alt = stringAttribute(attributes.alt)
          return alt ? { alt } : {}
        },
      },
    }
  },
})

export function FormatToolbar({ editorId, onUploadImage }: FormatToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadInserterRef = useRef<RichEditorImageInserter | null>(null)
  const controller = useRichEditorController(editorId)
  const editor = controller?.editor ?? null
  const disabled = !editor || Boolean(controller?.readOnly)
  const blockValue = editor?.isActive('heading', { level: 2 }) ? 'h2' : editor?.isActive('heading', { level: 3 }) ? 'h3' : 'p'

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
    if (!file || !insertImage || !onUploadImage) return
    void onUploadImage({ file, insertImage })
  }

  return (
    <div className="format-toolbar" aria-label="Formatting toolbar">
      <select
        value={blockValue}
        aria-label="Block style"
        disabled={disabled}
        onChange={(event) => {
          setBlockStyle(editor, event.target.value)
        }}
      >
        <option value="p">Paragraph</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <span className="toolbar-divider" />
      <ToolbarButton label="Bold" icon={Bold} active={editor?.isActive('bold')} disabled={disabled} command={() => editor?.chain().focus().toggleBold().run()} />
      <ToolbarButton label="Italic" icon={Italic} active={editor?.isActive('italic')} disabled={disabled} command={() => editor?.chain().focus().toggleItalic().run()} />
      <ToolbarButton
        label="Bulleted list"
        icon={List}
        active={editor?.isActive('bulletList')}
        disabled={disabled}
        command={() => editor?.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="Checklist"
        icon={ListChecks}
        active={editor?.isActive('taskList')}
        disabled={disabled}
        command={() => editor?.chain().focus().toggleTaskList().run()}
      />
      <ToolbarButton label="Link" icon={Link2} active={editor?.isActive('link')} disabled={disabled} command={() => editLink(editor)} />
      <ToolbarButton label="Upload image" icon={ImageIcon} command={requestImageUpload} disabled={disabled || !onUploadImage} />
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
  const previewLoadRef = useRef(0)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          blockquote: false,
          code: false,
          codeBlock: false,
          heading: { levels: [2, 3] },
          horizontalRule: false,
          link: false,
          strike: false,
        }),
        Link.configure({
          autolink: true,
          enableClickSelection: true,
          linkOnPaste: true,
          openOnClick: false,
          HTMLAttributes: {
            target: '_blank',
            rel: 'noreferrer',
          },
          isAllowedUri: (url) => isSafeEditorLinkUrl(url),
          shouldAutoLink: (url) => isSafeEditorLinkUrl(url),
        }),
        ManagedImage.configure({
          allowBase64: true,
        }),
        TaskList,
        TaskItem.configure({
          nested: false,
        }),
        Placeholder.configure({
          placeholder,
        }),
      ],
      content: normalizeEditorHtml(value),
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
        const nextValue = normalizeEditorHtml(updatedEditor.getHTML())
        onChangeRef.current?.(nextValue)
        queueManagedPreviewHydration(updatedEditor, previewLoadRef)
        notifyRichEditorRegistry()
      },
      onSelectionUpdate: () => notifyRichEditorRegistry(),
      onTransaction: () => notifyRichEditorRegistry(),
    },
    [ariaLabel, className, editorId, placeholder, readOnly],
  )

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor) return
    const normalizedValue = normalizeEditorHtml(value)
    if (normalizeEditorHtml(editor.getHTML()) !== normalizedValue) {
      editor.commands.setContent(normalizedValue, { emitUpdate: false })
    }
    queueManagedPreviewHydration(editor, previewLoadRef)
  }, [editor, value])

  useEffect(() => {
    if (!editor || !editorId) return
    const insertImage: RichEditorImageInserter = (attachmentId, filename, previewSrc) => {
      const source = `${managedAttachmentProtocol}${attachmentId}`
      editor
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

      if (previewSrc) {
        queueManagedPreviewHydration(editor, previewLoadRef)
      }
    }

    return registerRichEditor(editorId, { editor, insertImage, readOnly })
  }, [editor, editorId, readOnly])

  if (!editor) {
    return <div id={editorId} className={['rich-editor', className].filter(Boolean).join(' ')} role="textbox" aria-label={ariaLabel} data-placeholder={placeholder} />
  }

  return <EditorContent editor={editor} />
}

function ToolbarButton({
  label,
  icon: Icon,
  command,
  active = false,
  disabled = false,
}: {
  label: string
  icon: LucideIcon
  command: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button className="toolbar-button" type="button" aria-label={label} title={label} disabled={disabled} aria-pressed={active} onClick={command}>
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

function editLink(editor: Editor | null) {
  if (!editor) return
  const previousUrl = typeof editor.getAttributes('link').href === 'string' ? editor.getAttributes('link').href : ''
  const nextUrl = window.prompt(previousUrl ? 'Edit link URL. Leave blank to remove it.' : 'Link URL', previousUrl)
  if (nextUrl === null) return

  const trimmedUrl = nextUrl.trim()
  if (!trimmedUrl) {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }

  if (!isSafeEditorLinkUrl(trimmedUrl)) {
    window.alert('Use an http, https, or mailto link.')
    return
  }

  editor.chain().focus().extendMarkRange('link').setLink({ href: trimmedUrl }).run()
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
    'data-placeholder': placeholder,
    spellcheck: String(!readOnly),
  }

  if (editorId) attributes.id = editorId
  if (readOnly) attributes['aria-readonly'] = 'true'
  return attributes
}

function queueManagedPreviewHydration(editor: Editor, previewLoadRef: { current: number }) {
  const loadId = previewLoadRef.current + 1
  previewLoadRef.current = loadId
  window.queueMicrotask(() => {
    void hydrateManagedAttachmentPreviews(editor.view.dom as HTMLElement, () => previewLoadRef.current === loadId)
  })
}

function stringAttribute(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function managedAttachmentIdFromSource(source: string): string | null {
  if (!source.startsWith(managedAttachmentProtocol)) return null
  return source.slice(managedAttachmentProtocol.length)
}
