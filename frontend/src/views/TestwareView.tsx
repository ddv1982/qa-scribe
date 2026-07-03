import { Box } from 'lucide-react'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import {
  parseTestwareGenerationMetadata,
  testwareDepthLabel,
  testwareOutputFormatLabel,
  testwareTechniqueLabel,
} from '../testware/generationPreferences'
import type { Draft, GenerationJobStatus } from '../tauri'
import type { BusyAction } from '../ui/types'
import { RecordCollectionView } from './RecordCollectionView'

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
  return (
    <RecordCollectionView
      eyebrow="Testware"
      heading="Test cases"
      emptyIcon={Box}
      emptyTitle="No testware yet"
      prefillBusyAction="prefill-testware"
      prefillLabel="Prefill from note"
      manualBusyAction="manual-testware"
      manualLabel="New testware"
      busyAction={busyAction}
      copiedRecordId={copiedDraftId}
      copiedRecordScreenshotId={copiedDraftScreenshotId}
      recordScreenshotCounts={draftScreenshotCounts}
      records={drafts}
      notice={notice}
      error={error}
      isBusy={isBusy}
      activeGenerationJob={activeGenerationJob}
      generationTitle="Generating test cases"
      generationTitleAriaLabel="Pending testware title"
      generationPlaceholder="Preparing testware..."
      generationBodyAriaLabel="Pending generated testware"
      editorIdPrefix="testware-editor"
      titleInputLabel="Testware title"
      recordNounLower="testware"
      bodyAriaLabelSuffix="testware"
      placeholder="Write test cases..."
      previewFallbackHtml="<p>No testware detail yet.</p>"
      renderPreviewHeader={(draft) => {
        const generationMetadata = parseTestwareGenerationMetadata(draft)
        return (
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
        )
      }}
      deleteBusyAction={(draft) => `delete-draft:${draft.id}`}
      copyBusyAction={(draft) => `copy-draft:${draft.id}`}
      copyScreenshotBusyAction={(draft) => `copy-draft-screenshot:${draft.id}`}
      savingBusyAction={(draft) => `draft:${draft.id}`}
      updateLocalRecord={updateLocalDraft}
      onCancelGenerationJob={onCancelGenerationJob}
      onCopyRecord={onCopyDraft}
      onCopyRecordScreenshot={onCopyDraftScreenshot}
      onDeleteRecord={onDeleteDraft}
      onManualCreate={onManualCreate}
      onPrefillFromNote={onPrefillFromNote}
      onSaveRecord={onSaveDraft}
      onUploadImage={onUploadImage}
    />
  )
}
