import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { Extension } from '@tiptap/core'
import type { UndoRedoOptions } from '@tiptap/extensions'
import { history } from '@tiptap/pm/history'
import {
  createManagedAttachmentPreviewCache,
  hydrateManagedAttachmentPreviews,
  managedAttachmentProtocol,
  type ManagedAttachmentPreviewCache,
} from './editorHtml'
import { richTextEditorExtensions } from './editorExtensions'
import { normalizeRichEditorDocument, richEditorDocumentsEqual, type RichEditorDocument } from './editorDocument'
import { notifyRichEditorRegistry, registerRichEditor, setActiveRichEditor, type RichEditorImageInserter } from './richEditorRegistry'

export { FormatToolbar } from './FormatToolbar'
export type { RichEditorImageInserter, RichEditorImageUpload } from './richEditorRegistry'

type RichTextEditorProps = {
  value: RichEditorDocument
  onChange?: (value: RichEditorDocument) => void
  ariaLabel?: string
  placeholder?: string
  readOnly?: boolean
  className?: string
  editorId?: string
  historyScope?: string
  transformPastedHTML?: (html: string) => string
  pendingImagePreviews?: readonly { id: string; dataUrl: string }[]
}

export function RichTextEditor({
  value,
  onChange,
  ariaLabel = 'Note body',
  placeholder = 'Write testing notes...',
  readOnly = false,
  className,
  editorId,
  historyScope,
  transformPastedHTML,
  pendingImagePreviews,
}: RichTextEditorProps) {
  const previewLoadRef = useRef(0)
  const previewRetryTimerRef = useRef<number | null>(null)
  const [previewCache] = useState(() => createManagedAttachmentPreviewCache())
  const onChangeRef = useRef(onChange)
  const historyScopeRef = useRef(historyScope)

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
        transformPastedHTML,
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
    editor.setEditable(!readOnly, false)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    for (const { id, dataUrl } of pendingImagePreviews ?? []) previewCache.seed(id, dataUrl)
    const normalizedValue = normalizeRichEditorDocument(value)
    const currentValue = normalizeRichEditorDocument({ schemaVersion: 1, doc: editor.getJSON() })
    if (!richEditorDocumentsEqual(currentValue, normalizedValue)) {
      editor.commands.setContent(normalizedValue.doc, { emitUpdate: false })
    }
    if (historyScopeRef.current !== historyScope) {
      const undoRedo = editor.extensionManager.extensions.find((extension): extension is Extension<UndoRedoOptions> => extension.name === 'undoRedo')
      if (undoRedo) {
        editor.unregisterPlugin('history')
        editor.registerPlugin(history(undoRedo.options))
      }
      historyScopeRef.current = historyScope
    }
    queueManagedPreviewHydration(editor, previewLoadRef, previewRetryTimerRef, previewCache)
  }, [editor, historyScope, pendingImagePreviews, previewCache, value])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !editorId) return
    const insertImage: RichEditorImageInserter = (attachmentId, filename, previewSrc) => {
      if (editor.isDestroyed) return false
      const source = attachmentId !== null ? `${managedAttachmentProtocol}${attachmentId}` : previewSrc
      if (!source) return false
      if (attachmentId && previewSrc) previewCache.seed(attachmentId, previewSrc)
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
