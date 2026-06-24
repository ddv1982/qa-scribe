import { Box, CheckCircle2, Copy, FileText, Image as ImageIcon, Loader2, Plus, Save, Trash2, X } from 'lucide-react'
import { EmptyCollection, StatusPill } from '../components/Common'
import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from '../editor/RichTextEditor'
import type { Draft, GenerationJobStatus } from '../tauri'
import type { BusyAction } from '../ui/types'

export function TestwareView({
  busyAction,
  copiedDraftId,
  copiedDraftScreenshotId,
  draftScreenshotCounts,
  drafts,
  notice,
  error,
  isBusy,
  activeGenerationJob,
  updateLocalDraft,
  onCancelGenerationJob,
  onCopyDraft,
  onCopyDraftScreenshot,
  onDeleteDraft,
  onManualCreate,
  onPrefillFromNote,
  onSaveDraft,
  onUploadImage,
}: {
  busyAction: BusyAction | null
  copiedDraftId: string | null
  copiedDraftScreenshotId: string | null
  draftScreenshotCounts: Record<string, number>
  drafts: Draft[]
  notice: string | null
  error: string | null
  isBusy: boolean
  activeGenerationJob: GenerationJobStatus | null
  updateLocalDraft: (id: string, patch: Partial<Pick<Draft, 'title' | 'body'>>) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopyDraft: (draft: Draft) => Promise<void>
  onCopyDraftScreenshot: (draft: Draft) => Promise<void>
  onDeleteDraft: (draft: Draft) => void
  onManualCreate: () => Promise<void>
  onPrefillFromNote: () => Promise<void>
  onSaveDraft: (draft: Draft) => Promise<void>
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  return (
    <section className="collection-view">
      <header className="collection-header">
        <div>
          <p className="eyebrow">Testware</p>
          <h1>Test cases</h1>
        </div>
        <div className="collection-header-actions">
          <button className="secondary-button" type="button" disabled={isBusy} onClick={() => void onPrefillFromNote()}>
            {busyAction === 'prefill-testware' ? <Loader2 className="spin" size={16} /> : <FileText size={16} />}
            Prefill from note
          </button>
          <button className="primary-button" type="button" disabled={isBusy} onClick={() => void onManualCreate()}>
            {busyAction === 'manual-testware' ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            New testware
          </button>
        </div>
      </header>
      {notice || error ? (
        <div className="collection-status">
          <StatusPill notice={notice} error={error} busyAction={busyAction} />
        </div>
      ) : null}

      <div className="collection-stack">
        {activeGenerationJob ? (
          <article className="editable-record generation-record">
            <input readOnly value="Generating test cases" aria-label="Pending testware title" />
            <div className="rich-record-editor-field rich-record-preview-field">
              <RichTextEditor
                value={activeGenerationJob.partialText || activeGenerationJob.progressMessage || 'Preparing testware...'}
                ariaLabel="Pending generated testware"
                placeholder="Preparing testware..."
                readOnly
              />
            </div>
            <div className="record-actions">
              <span className="generation-progress">
                <Loader2 className="spin" size={16} />
                {activeGenerationJob.progressMessage}
              </span>
              <button
                className="secondary-button"
                type="button"
                disabled={activeGenerationJob.state === 'cancelling'}
                onClick={() => void onCancelGenerationJob(activeGenerationJob.jobId)}
              >
                {activeGenerationJob.state === 'cancelling' ? <Loader2 className="spin" size={16} /> : <X size={16} />}
                Cancel
              </button>
            </div>
          </article>
        ) : null}
        {drafts.map((draft) => {
          const deletingDraft = busyAction === `delete-draft:${draft.id}`
          const copyingDraft = busyAction === `copy-draft:${draft.id}`
          const copyingDraftScreenshot = busyAction === `copy-draft-screenshot:${draft.id}`
          const draftCopied = copiedDraftId === draft.id
          const draftScreenshotCopied = copiedDraftScreenshotId === draft.id
          const draftScreenshotCount = draftScreenshotCounts[draft.id] ?? 0
          const savingDraft = busyAction === `draft:${draft.id}`
          const editorId = `testware-editor-${draft.id}`
          const draftTitle = draft.title.trim()
          const copyLabel = draftCopyLabel(draftTitle, draftCopied)
          const screenshotCopyLabel = draftScreenshotCopyLabel(draftTitle, draftScreenshotCopied, draftScreenshotCount)
          return (
            <article className="editable-record" key={draft.id}>
              <input value={draft.title} aria-label="Testware title" onChange={(event) => updateLocalDraft(draft.id, { title: event.target.value })} />
              <div className="rich-record-editor-field">
                <FormatToolbar editorId={editorId} onUploadImage={onUploadImage} />
                <RichTextEditor
                  editorId={editorId}
                  value={draft.body}
                  onChange={(body) => updateLocalDraft(draft.id, { body })}
                  ariaLabel={`${draft.title} testware body`}
                  placeholder="Write test cases..."
                />
              </div>
              <div className="record-actions">
                <button
                  className={draftCopied ? 'icon-button success' : 'icon-button'}
                  type="button"
                  aria-label={copyLabel}
                  title={draftCopied ? 'Copied' : 'Copy for Jira'}
                  disabled={isBusy}
                  onClick={() => void onCopyDraft(draft)}
                >
                  {copyingDraft ? <Loader2 className="spin" size={16} /> : draftCopied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                </button>
                {draftScreenshotCount > 0 ? (
                  <button
                    className={draftScreenshotCopied ? 'icon-button success' : 'icon-button'}
                    type="button"
                    aria-label={screenshotCopyLabel}
                    title={draftScreenshotCopied ? 'Screenshot copied' : draftScreenshotCount > 1 ? 'Copy first screenshot' : 'Copy screenshot'}
                    disabled={isBusy}
                    onClick={() => void onCopyDraftScreenshot(draft)}
                  >
                    {copyingDraftScreenshot ? <Loader2 className="spin" size={16} /> : draftScreenshotCopied ? <CheckCircle2 size={16} /> : <ImageIcon size={16} />}
                  </button>
                ) : null}
                <button className="secondary-button" type="button" disabled={isBusy} onClick={() => void onSaveDraft(draft)}>
                  {savingDraft ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                  Save
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  aria-label={`Delete ${draft.title}`}
                  title="Delete testware"
                  disabled={isBusy}
                  onClick={() => void onDeleteDraft(draft)}
                >
                  {deletingDraft ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                </button>
              </div>
            </article>
          )
        })}
        {drafts.length === 0 && !activeGenerationJob ? <EmptyCollection icon={Box} title="No testware yet" /> : null}
      </div>
    </section>
  )
}

function draftCopyLabel(title: string, copied: boolean): string {
  if (copied) return title ? `${title} copied for Jira` : 'Testware copied for Jira'
  return title ? `Copy ${title} for Jira` : 'Copy testware for Jira'
}

function draftScreenshotCopyLabel(title: string, copied: boolean, count: number): string {
  if (copied) return title ? `${title} screenshot copied for Jira` : 'Testware screenshot copied for Jira'
  if (count > 1) return title ? `Copy first ${title} screenshot for Jira` : 'Copy first testware screenshot for Jira'
  return title ? `Copy ${title} screenshot for Jira` : 'Copy testware screenshot for Jira'
}
