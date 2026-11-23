import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import { imageFileFromClipboardData, shouldReadNativeClipboardImage } from '../app/attachmentActions'
import { ActionButton } from '../components/ActionButton'
import {
  managedAttachmentImagesInDocument, parseRichEditorDocument, richEditorDocumentFromPlainText,
  serializeRichEditorDocument, type RichEditorDocument,
} from '../editor/editorDocument'
import { managedAttachmentProtocol, normalizeEditorHtml, pastedImageFilename, readFileAsDataUrl, stripHtml } from '../editor/editorHtml'
import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from '../editor/RichTextEditor'
import { richEditorControllerForId, richEditorImageInserterForId, type RichEditorImageInserter } from '../editor/richEditorRegistry'
import { readClipboardImageDataUrl, type TestCaseNoteImage } from '../tauri'
import type { CasePatch, EditableTestCase } from '../testware/caseSaveQueue'
import { notesText } from '../testware/testRunNotes'
import { trackNoteImageRead } from '../testware/useTestRuns'
import { formatError } from '../ui/format'

const maxImageBytes = 10 * 1024 * 1024

export function TestRunNotes({ testCase, onChange }: { testCase: EditableTestCase; onChange: (patch: CasePatch) => void }) {
  const [editing, setEditing] = useState(false)
  const [reading, setReading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const id = useId()
  const editorId = `${id}-editor`
  const pending = useRef(new Map<string, TestCaseNoteImage>())
  const readingRef = useRef(false)
  const { notes, remark, title, notesSave, notesError } = testCase
  const document = useMemo(() => parseRichEditorDocument(notes?.bodyJson) ?? richEditorDocumentFromPlainText(remark ?? ''), [notes?.bodyJson, remark])
  const latestDocument = useRef(document)
  useEffect(() => { latestDocument.current = document }, [document])
  const references = useMemo(() => managedAttachmentImagesInDocument(document), [document])
  const preview = notes?.text ?? remark
  const count = notes?.imageCount ?? 0
  const hasNotes = Boolean(preview || count)

  useEffect(() => {
    if (!notesSave) {
      for (const { attachmentId } of references) pending.current.delete(attachmentId)
    }
  }, [notesSave, references])

  function save(next: RichEditorDocument) {
    latestDocument.current = next
    const imageRefs = managedAttachmentImagesInDocument(next)
    const bodyJson = serializeRichEditorDocument(next)
    onChange({ notesDraft: {
      notes: { bodyJson, text: notesText(next), imageCount: imageRefs.length },
      images: imageRefs.flatMap(({ attachmentId }) => pending.current.get(attachmentId) ?? []),
    } })
  }

  function addImage(insert: RichEditorImageInserter, filename: string, read: () => Promise<string | null>) {
    return trackNoteImageRead(testCase.runId, readAndInsertImage(insert, filename, read))
  }

  async function readAndInsertImage(insert: RichEditorImageInserter, filename: string, read: () => Promise<string | null>) {
    if (readingRef.current) return
    readingRef.current = true
    setReading(true)
    setImageError(null)
    try {
      if (references.length >= 8) throw new Error('Result notes can contain up to 8 images.')
      const dataUrl = await read()
      if (!dataUrl) throw new Error('There is no screenshot on the clipboard.')
      if (dataUrl.length > Math.ceil(maxImageBytes / 3) * 4 + 64) throw new Error('Images must be at most 10 MiB each.')
      const image = { id: crypto.randomUUID(), filename, dataUrl }
      pending.current.set(image.id, image)
      if (richEditorImageInserterForId(editorId) !== insert) {
        const latest = latestDocument.current
        save({ ...latest, doc: { ...latest.doc, content: [
          ...latest.doc.content ?? [],
          { type: 'image', attrs: { attachmentId: image.id, src: managedAttachmentProtocol + image.id, alt: filename } },
        ] } })
      } else if (!insert(image.id, filename, dataUrl)) {
        pending.current.delete(image.id)
        throw new Error('The screenshot could not be inserted.')
      }
    } catch (cause) {
      if (richEditorImageInserterForId(editorId) === insert) setImageError(formatError(cause))
    } finally {
      readingRef.current = false
      setReading(false)
    }
  }

  function chooseImage({ insertImage, file }: RichEditorImageUpload) {
    return addImage(insertImage, pastedImageFilename(file), () => {
      if (file.size > maxImageBytes) throw new Error('Images must be at most 10 MiB each.')
      return readFileAsDataUrl(file)
    })
  }

  function paste(event: ClipboardEvent<HTMLElement>) {
    const controller = richEditorControllerForId(editorId)
    if (!controller || !(event.target instanceof Element) || !event.target.closest('[contenteditable="true"]')) return
    const { editor, insertImage } = controller
    const clipboard = event.clipboardData
    const file = imageFileFromClipboardData(clipboard)
    const plain = clipboard.getData('text/plain')
    const html = clipboard.getData('text/html')
    const hasPlainText = Boolean(plain.trim())
    const hasHtmlText = Boolean(html && stripHtml(withoutPastedImages(html)))
    const usePlainText = html && !hasHtmlText && hasPlainText
    if (usePlainText || (file && !hasHtmlText && !hasPlainText)) {
      event.preventDefault()
      event.stopPropagation()
      if (usePlainText) editor.view.pasteText(plain)
    }
    if (file) {
      void chooseImage({ editorId, file, insertImage })
    } else if (!hasPlainText && !hasHtmlText && shouldReadNativeClipboardImage(clipboard)) {
      event.preventDefault()
      event.stopPropagation()
      void addImage(insertImage, 'pasted-screenshot.png', readClipboardImageDataUrl)
    }
  }

  const label = editing || hasNotes ? 'Result notes' : 'Add result notes'
  return <div className="test-run-notes">
    <button className="test-run-notes-toggle" type="button" aria-expanded={editing} aria-controls={id}
      aria-label={`${label} for ${title}`} aria-description={count ? `${count} ${count === 1 ? 'image' : 'images'}` : undefined} onClick={() => setEditing(!editing)} disabled={reading}>
      <ChevronRight size={14} className="disclosure-chevron" aria-hidden="true" />
      {label}{!editing && count ? ` · ${count} ${count === 1 ? 'image' : 'images'}` : ''}
    </button>
    {!editing && preview ? <p className="test-run-notes-preview">{preview}</p> : null}
    <div id={id} hidden={!editing} onPasteCapture={paste}>
      {editing ? <div className="test-run-notes-editor">
        <FormatToolbar editorId={editorId} onUploadImage={chooseImage} />
        <RichTextEditor editorId={editorId} value={document} onChange={save}
          ariaLabel={`Result notes for ${title}`} placeholder="Write what happened or paste a screenshot…"
          transformPastedHTML={withoutPastedImages} pendingImagePreviews={testCase.pendingNoteImages} />
      </div> : null}
    </div>
    <div className="test-run-notes-status" role="status">
      {reading ? 'Reading image…' : notesSave === 'saving' ? 'Saving result notes…' : editing && notes && !notesSave ? 'Saved' : ''}
    </div>
    {notesSave === 'failed' ? <div className="test-run-notes-error">
      <span role="alert">{notesError ? `Result notes could not be saved. ${notesError}` : 'Result notes could not be saved.'}</span>
      <ActionButton variant="quiet" onClick={() => save(document)}>Retry</ActionButton>
    </div> : null}
    {imageError ? <p role="alert" className="field-error">{imageError}</p> : null}
  </div>
}

function withoutPastedImages(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = normalizeEditorHtml(html)
  template.content.querySelectorAll('img').forEach(image => image.remove())
  return template.innerHTML
}
