import { generateHTML, generateJSON, type JSONContent } from '@tiptap/core'
import { richTextEditorExtensions } from './editorExtensions'
import { emptyEditorHtml, managedAttachmentProtocol, normalizeEditorHtml, stripHtml } from './editorHtml'

export type RichEditorDocument = {
  schemaVersion: 1
  doc: JSONContent
}

export type StoredRichBody = {
  body: string
  bodyJson?: string | null
  bodyFormat?: string | null
}

export const emptyRichEditorDoc: JSONContent = {
  type: 'doc',
  content: [],
}

export const emptyRichEditorDocument: RichEditorDocument = {
  schemaVersion: 1,
  doc: emptyRichEditorDoc,
}

export function richEditorDocumentFromStoredBody(record: StoredRichBody): RichEditorDocument {
  const parsed = parseRichEditorDocument(record.bodyJson)
  if (parsed) return parsed
  return richEditorDocumentFromHtml(record.body)
}

export function richEditorDocumentFromHtml(html: string): RichEditorDocument {
  const normalizedHtml = normalizeEditorHtml(html)
  if (!normalizedHtml) return emptyRichEditorDocument

  try {
    return normalizeRichEditorDocument({
      schemaVersion: 1,
      doc: generateJSON(normalizedHtml, richTextEditorExtensions()) as JSONContent,
    })
  } catch {
    return richEditorDocumentFromPlainText(stripHtml(normalizedHtml))
  }
}

export function richEditorDocumentFromPlainText(value: string): RichEditorDocument {
  const text = value.trim()
  if (!text) return emptyRichEditorDocument
  return richEditorDocumentFromHtml(`<p>${escapeHtml(text).replace(/\n/g, '<br />')}</p>`)
}

export function richEditorDocumentToHtml(document: RichEditorDocument): string {
  try {
    return normalizeEditorHtml(generateHTML(normalizeRichEditorDocument(document).doc, richTextEditorExtensions()))
  } catch {
    return emptyEditorHtml
  }
}

export function richEditorDocumentToPlainText(document: RichEditorDocument): string {
  return stripHtml(richEditorDocumentToHtml(document))
}

export function serializeRichEditorDocument(document: RichEditorDocument): string {
  return JSON.stringify(normalizeRichEditorDocument(document))
}

export function richEditorDocumentToStoredBody(document: RichEditorDocument): {
  body: string
  bodyJson: string
  bodyFormat: 'tiptap_json'
} {
  const normalized = normalizeRichEditorDocument(document)
  return {
    body: richEditorDocumentToHtml(normalized),
    bodyJson: serializeRichEditorDocument(normalized),
    bodyFormat: 'tiptap_json',
  }
}

export function normalizeRichEditorDocument(document: RichEditorDocument): RichEditorDocument {
  const doc = isJsonContent(document.doc) && document.doc.type === 'doc' ? document.doc : emptyRichEditorDoc
  const normalized: RichEditorDocument = { schemaVersion: 1, doc }
  return isVisuallyEmptyRichEditorDocument(normalized) ? emptyRichEditorDocument : normalized
}

export function parseRichEditorDocument(value: string | null | undefined): RichEditorDocument | null {
  if (!value?.trim()) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isJsonContent(parsed.doc)) return null
    return normalizeRichEditorDocument({ schemaVersion: 1, doc: parsed.doc })
  } catch {
    return null
  }
}

export function richEditorDocumentsEqual(left: RichEditorDocument, right: RichEditorDocument): boolean {
  return serializeRichEditorDocument(left) === serializeRichEditorDocument(right)
}

export function preserveManagedImageNodes(base: RichEditorDocument, generated: RichEditorDocument): RichEditorDocument {
  const normalizedBase = normalizeRichEditorDocument(base)
  const normalizedGenerated = cloneRichEditorDocument(normalizeRichEditorDocument(generated))
  const generatedImageKeys = new Set(preservableImageNodes(normalizedGenerated).map(({ key }) => key))
  const missingImages = preservableImageNodes(normalizedBase)
    .filter(({ key }) => !generatedImageKeys.has(key))
    .map(({ node }) => cloneJsonContent(node))

  if (missingImages.length === 0) return normalizedGenerated

  const content = Array.isArray(normalizedGenerated.doc.content) ? [...normalizedGenerated.doc.content] : []
  return normalizeRichEditorDocument({
    schemaVersion: 1,
    doc: {
      ...normalizedGenerated.doc,
      content: [...content, ...missingImages],
    },
  })
}

function isVisuallyEmptyRichEditorDocument(document: RichEditorDocument): boolean {
  const html = richEditorDocumentToHtmlUnsafe(document)
  if (!html.trim()) return true
  return normalizeEditorHtml(html) === emptyEditorHtml
}

function richEditorDocumentToHtmlUnsafe(document: RichEditorDocument): string {
  try {
    return generateHTML(document.doc, richTextEditorExtensions())
  } catch {
    return emptyEditorHtml
  }
}

function isJsonContent(value: unknown): value is JSONContent {
  return isRecord(value) && typeof value.type === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneRichEditorDocument(document: RichEditorDocument): RichEditorDocument {
  return {
    schemaVersion: 1,
    doc: cloneJsonContent(document.doc),
  }
}

function cloneJsonContent(content: JSONContent): JSONContent {
  return JSON.parse(JSON.stringify(content)) as JSONContent
}

function preservableImageNodes(document: RichEditorDocument): Array<{ key: string; node: JSONContent }> {
  const nodes: Array<{ key: string; node: JSONContent }> = []
  walkJsonContent(document.doc, (node) => {
    const key = preservableImageNodeKey(node)
    if (!key || nodes.some((entry) => entry.key === key)) return
    nodes.push({ key, node })
  })
  return nodes
}

function walkJsonContent(node: JSONContent, visit: (node: JSONContent) => void) {
  visit(node)
  node.content?.forEach((child) => walkJsonContent(child, visit))
}

function preservableImageNodeKey(node: JSONContent): string | null {
  if (node.type !== 'image') return null
  const attachmentId = stringAttribute(node.attrs?.attachmentId)
  if (attachmentId) return `attachment:${attachmentId}`
  const src = stringAttribute(node.attrs?.src)
  if (src?.startsWith(managedAttachmentProtocol)) return `attachment:${src.slice(managedAttachmentProtocol.length)}`
  if (src && isPreservableExternalImageSource(src)) return `src:${src}`
  return null
}

function stringAttribute(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function isPreservableExternalImageSource(source: string): boolean {
  try {
    const url = new URL(source)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
