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
import { RecordCollectionView, type RecordCollectionLabels } from './RecordCollectionView'

const testwareLabels: RecordCollectionLabels = {
  eyebrow: 'Testware',
  heading: 'Test cases',
  emptyTitle: 'No testware yet',
  prefillLabel: 'Prefill from note',
  manualLabel: 'New testware',
  generationTitle: 'Generating test cases',
  generationTitleAriaLabel: 'Pending testware title',
  generationPlaceholder: 'Preparing testware...',
  generationBodyAriaLabel: 'Pending generated testware',
  editorIdPrefix: 'testware-editor',
  titleInputLabel: 'Testware title',
  recordNounLower: 'testware',
  bodyAriaLabelSuffix: 'testware',
  placeholder: 'Write test cases...',
  previewFallbackHtml: '<p>No testware detail yet.</p>',
}

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
      labels={testwareLabels}
      emptyIcon={Box}
      prefillBusyAction="prefill-testware"
      manualBusyAction="manual-testware"
      busyAction={busyAction}
      copiedRecordId={copiedDraftId}
      copiedRecordScreenshotId={copiedDraftScreenshotId}
      recordScreenshotCounts={draftScreenshotCounts}
      records={drafts}
      notice={notice}
      error={error}
      isBusy={isBusy}
      activeGenerationJob={activeGenerationJob}
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
      busyActionFor={(draft, kind) => {
        switch (kind) {
          case 'delete':
            return `delete-draft:${draft.id}`
          case 'copy':
            return `copy-draft:${draft.id}`
          case 'copyScreenshot':
            return `copy-draft-screenshot:${draft.id}`
          case 'saving':
            return `draft:${draft.id}`
        }
      }}
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
