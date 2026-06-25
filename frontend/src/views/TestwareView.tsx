import { useState } from 'react'
import { Box, CheckCircle2, Copy, FileText, Image as ImageIcon, Loader2, PencilLine, Plus, Save, Trash2 } from 'lucide-react'
import { EmptyCollection, StatusPill } from '../components/Common'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import {
  parseTestwareGenerationMetadata,
  testwareDepthLabel,
  testwareOutputFormatLabel,
  testwareTechniqueLabel,
} from '../testware/generationPreferences'
import type { Draft, GenerationJobStatus } from '../tauri'
import type { BusyAction } from '../ui/types'
import { EditableRichRecord, GenerationRecord } from './RichRecordView'

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
  updateLocalDraft: (id: string, patch: Partial<Pick<Draft, 'title' | 'body' | 'bodyJson' | 'bodyFormat'>>) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopyDraft: (draft: Draft) => Promise<void>
  onCopyDraftScreenshot: (draft: Draft) => Promise<void>
  onDeleteDraft: (draft: Draft) => void
  onManualCreate: () => Promise<void>
  onPrefillFromNote: () => Promise<void>
  onSaveDraft: (draft: Draft) => Promise<boolean>
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  const [editingDraftIds, setEditingDraftIds] = useState<Record<string, boolean>>({})
  const setDraftEditing = (id: string, editing: boolean) => setEditingDraftIds((previous) => ({ ...previous, [id]: editing }))

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
          <GenerationRecord
            title="Generating test cases"
            titleAriaLabel="Pending testware title"
            job={activeGenerationJob}
            placeholder="Preparing testware..."
            bodyAriaLabel="Pending generated testware"
            onCancelGenerationJob={onCancelGenerationJob}
          />
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
          const editingDraft = Boolean(editingDraftIds[draft.id])
          const generationMetadata = parseTestwareGenerationMetadata(draft)
          return (
            <EditableRichRecord
              key={draft.id}
              record={draft}
              editing={editingDraft}
              editorId={editorId}
              titleInputLabel="Testware title"
              bodyAriaLabel={`${draft.title} testware ${editingDraft ? 'body' : 'preview'}`}
              placeholder="Write test cases..."
              previewFallbackHtml="<p>No testware detail yet.</p>"
              previewHeader={
                <div className="record-heading-row">
                  <h2 className="record-title">{draft.title}</h2>
                  {generationMetadata ? (
                    <div className="testware-metadata-badges" aria-label="Testware generation settings">
                      <span>{testwareTechniqueLabel(generationMetadata.technique)}</span>
                      <span>{testwareDepthLabel(generationMetadata.depth)}</span>
                      <span>{testwareOutputFormatLabel(generationMetadata.outputFormat)}</span>
                    </div>
                  ) : null}
                </div>
              }
              onTitleChange={(title) => updateLocalDraft(draft.id, { title })}
              onBodyChange={(patch) => updateLocalDraft(draft.id, patch)}
              onUploadImage={onUploadImage}
              actions={
                <>
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
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    if (editingDraft) {
                      void onSaveDraft(draft).then((saved) => {
                        if (saved) setDraftEditing(draft.id, false)
                      })
                    } else {
                      setDraftEditing(draft.id, true)
                    }
                  }}
                >
                  {savingDraft ? <Loader2 className="spin" size={16} /> : editingDraft ? <Save size={16} /> : <PencilLine size={16} />}
                  {editingDraft ? 'Save' : 'Edit'}
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
                </>
              }
            />
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
