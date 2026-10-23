import type { JSONContent } from '@tiptap/core'
import type { CreationImageDescriptor, CreationImageInput, PreparedCreationImage } from '../tauri'
import { cloneRichEditorDocument, richEditorDocumentToStoredBody, type RichEditorDocument } from '../editor/editorDocument'
import { managedAttachmentProtocol } from '../editor/editorHtml'
import { managedAttachmentIdFromSrc } from '../editor/htmlUtils'

function images(document: RichEditorDocument): JSONContent[] {
  const result: JSONContent[] = []
  function visit(node: JSONContent) {
    if (node.type === 'image') result.push(node)
    node.content?.forEach(visit)
  }
  visit(document.doc)
  return result
}

export async function creationImageInputs(document: RichEditorDocument): Promise<{
  descriptors: CreationImageDescriptor[]; inputs: CreationImageInput[]; shared: string[]
}> {
  const descriptors: CreationImageDescriptor[] = []
  const inputs: CreationImageInput[] = []
  const shared = new Set<string>()
  const seen = new Set<string>()
  for (const image of images(document)) {
    const src = typeof image.attrs?.src === 'string' ? image.attrs.src : ''
    const id = typeof image.attrs?.attachmentId === 'string' && image.attrs.attachmentId
      ? image.attrs.attachmentId : managedAttachmentIdFromSrc(src)
    if (id) { shared.add(id); continue }
    if (!src.startsWith('data:image/')) continue
    if (seen.has(src)) continue
    seen.add(src)
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(src)
    if (!match || match[2].length > 35_000_000) throw new Error('Image must be a supported base64 image under 25 MiB.')
    const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0))
    if (bytes.length > 25 * 1024 * 1024) throw new Error('Image exceeds the 25 MiB limit.')
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
    const localId = `image-${inputs.length}`
    descriptors.push({ localId, filename: String(image.attrs?.alt || `image-${inputs.length + 1}.png`), mimeType: match[1], sizeBytes: bytes.length, sha256 })
    inputs.push({ localId, dataUrl: src })
  }
  return { descriptors, inputs, shared: [...shared].sort() }
}

export function materializeCreationDocument(document: RichEditorDocument, inputs: CreationImageInput[], mapping: PreparedCreationImage[]) {
  const compact = cloneRichEditorDocument(document)
  for (const image of images(compact)) {
    const input = inputs.find((item) => item.dataUrl === image.attrs?.src)
    if (!input) continue
    const prepared = mapping.find((item) => item.localId === input.localId)
    if (!prepared) throw new Error('Prepared image mapping is incomplete.')
    image.attrs = { ...image.attrs, attachmentId: prepared.attachmentId, src: `${managedAttachmentProtocol}${prepared.attachmentId}` }
  }
  return richEditorDocumentToStoredBody(compact)
}
