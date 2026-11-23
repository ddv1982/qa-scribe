import { useEffect, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { commands, type ChatRef, type RefinementProposal, type TestCaseVisual } from '../bindings'
import { copyAttachmentImageToClipboard, copyLocalImageToClipboard } from '../tauri'
import type { ProposalControls } from '../app/sessionChat.proposals'
import { ActionButton } from '../components/ActionButton'
import { ImageDialog } from './ChatImages'
import { parseRichEditorDocument } from '../editor/editorDocument'
import { formatError } from '../ui/format'
import { renderDiagram, renderScreenshot } from './testCaseVisualRender'

type Preview = { image: string; before: string | null; replaced?: string | null; upload: string | null }
type PreviewState = { kind: 'ready'; value: Preview } | { kind: 'error'; message: string }

async function previewVisual(reference: ChatRef, id: string, visual: TestCaseVisual): Promise<Preview> {
  const action = visual.action
  if (action.kind === 'diagram' && !action.replace) {
    const image = renderDiagram(action)
    return { image, before: null, upload: image }
  }
  const { source, replaced } = await commands.reviewVisualRefinement(reference, id)
  if (action.kind === 'diagram') {
    const image = renderDiagram(action)
    return { image, before: replaced, upload: image }
  }
  if (!source) throw new Error('The source image is unavailable.')
  if (action.kind === 'annotate') {
    const image = await renderScreenshot(action, source)
    return { image, before: source, replaced: replaced === source ? null : replaced, upload: image }
  }
  return { image: source, before: replaced === source ? null : replaced, upload: null }
}

function text(node: JSONContent | undefined): string {
  return node?.text ?? node?.content?.map(text).join('') ?? ''
}

function placement(proposal: RefinementProposal, visual: TestCaseVisual) {
  const document = parseRichEditorDocument(proposal.before.documentJson)
  const top = document?.doc.content ?? []
  const [index, ...nested] = visual.target
  const heading = top.slice(0, index + 1).reverse().find(node => node.type === 'heading')
  const target = nested.reduce<JSONContent | undefined>((node, part) => node?.content?.[part], top[index])
  const label = target?.type === 'image' ? target.attrs?.alt as unknown : text(target)
  const names = [...new Set([text(heading), typeof label === 'string' ? label : ''].filter(Boolean))]
  return names.join(' · ').slice(0, 220)
}

export function VisualProposalReview({ proposal, visual, reference, controls }: {
  proposal: RefinementProposal
  visual: TestCaseVisual
  reference?: ChatRef
  controls?: ProposalControls
}) {
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState<{ title: string; source: string } | null>(null)
  const [copyStatus, setCopyStatus] = useState<{ text: string; failed: boolean } | null>(null)
  const sessionId = reference?.sessionId
  const draftId = reference?.draftId
  const offered = proposal.state.kind === 'offered'
  const appliedId = proposal.state.kind === 'visual_applied' ? proposal.state.attachmentId : null
  const pending = controls?.pending.has(proposal.id)
  const error = controls?.errors[proposal.id]
  useEffect(() => {
    if (!offered || !sessionId || !draftId) return
    let active = true
    void previewVisual({ sessionId, draftId }, proposal.id, visual).then(value => {
      if (active) setPreview({ kind: 'ready', value })
    }).catch(error => {
      if (active) setPreview({ kind: 'error', message: formatError(error) })
    })
    return () => { active = false }
  }, [offered, sessionId, draftId, proposal.id, visual, attempt])

  async function copy() {
    try {
      if (appliedId) await copyAttachmentImageToClipboard(appliedId)
      else if (preview?.kind === 'ready') await copyLocalImageToClipboard(preview.value.image)
      setCopyStatus({ text: 'Image copied', failed: false })
    } catch (error) {
      setCopyStatus({ text: formatError(error), failed: true })
    }
  }

  function imagePreview(label: string, title: string, source: string) {
    return <figure>
      <figcaption>{label}</figcaption>
      <button type="button" aria-label={`View ${title}`} onClick={() => setExpanded({ title, source })}>
        <img src={source} alt={title} />
      </button>
    </figure>
  }

  if (!offered && !appliedId && proposal.state.kind !== 'visual_undone') return null
  const where = placement(proposal, visual)
  return <section className="chat-proposal chat-proposal--record" aria-label="Test case visual suggestion">
    {appliedId ? <p role="status">Test cases updated</p> : null}
    {proposal.state.kind === 'visual_undone' ? <p role="status">Visual update undone</p> : null}
    {offered && reference ? <>
      <h3>{visual.caption}</h3>
      {where ? <p className="chat-help">{where}</p> : null}
      {preview === null ? <p role="status">Preparing image preview…</p> : null}
      {preview?.kind === 'error' ? <><p role="alert">{preview.message}</p><ActionButton variant="quiet" onClick={() => { setPreview(null); setAttempt(value => value + 1) }}>Retry preview</ActionButton></> : null}
      {preview?.kind === 'ready' ? <div className="chat-visual-preview">
        {preview.value.before ? imagePreview('Original', 'Original image', preview.value.before) : null}
        {preview.value.replaced ? imagePreview('Will replace', 'Image to replace', preview.value.replaced) : null}
        {imagePreview(visual.action.kind === 'diagram' ? 'AI-generated diagram' : visual.action.kind === 'annotate' ? 'Edited screenshot' : 'Suggested image', visual.caption, preview.value.image)}
      </div> : null}
    </> : null}
    <div className="chat-buttons">
      {offered && controls?.onUpdate && reference ? <ActionButton variant="secondary" disabled={pending || Boolean(controls.applyUnavailable) || preview?.kind !== 'ready'}
        onClick={() => { if (preview?.kind === 'ready') void controls.onUpdate?.(proposal.id, reference, { image: preview.value.upload, undo: false }) }}>Update test cases</ActionButton> : null}
      {offered && controls && reference ? <ActionButton variant="quiet" disabled={pending}
        onClick={() => void controls.onAction(proposal.id, 'dismiss', reference)}>Dismiss</ActionButton> : null}
      {appliedId && controls?.onUpdate && reference ? <ActionButton variant="secondary" disabled={pending || Boolean(controls.applyUnavailable)}
        onClick={() => void controls.onUpdate?.(proposal.id, reference, { image: null, undo: true })}>Undo</ActionButton> : null}
      {appliedId || preview?.kind === 'ready' && offered ? <ActionButton variant="quiet" onClick={() => void copy()}>Copy image</ActionButton> : null}
    </div>
    {controls?.applyUnavailable ? <p className="chat-help">{controls.applyUnavailable}</p> : null}
    {error ? <p className="chat-error" role="alert">{error}</p> : null}
    {expanded ? <ImageDialog filename={expanded.title} preview={expanded.source} onClose={() => setExpanded(null)} /> : null}
    {copyStatus ? <p role={copyStatus.failed ? 'alert' : 'status'}>{copyStatus.text}</p> : null}
  </section>
}
