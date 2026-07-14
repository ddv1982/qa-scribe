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
import type { RecordLoadState } from '../app/useRecordHydration'
import { RecordCollectionView, type RecordCollectionLabels } from './RecordCollectionView'

const testwareLabels: RecordCollectionLabels = {
  eyebrow: 'Testware',
  heading: 'Test cases',
  emptyTitle: 'No testware yet',
  emptyDescription: 'Create testware from the current Session note, then refine and save it here.',
  emptyActionLabel: 'Prefill testware from note',
  prefillLabel: 'Prefill from note',
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
  sessionTitle = null,
  notice,
  error,
  isBusy,
  activeGenerationJob,
  initialSelectedRecordId = null,
  loadState = 'ready',
  loadError = null,
  onRetryLoad,
  updateLocalDraft,
  onCancelGenerationJob,
  onCopyDraft,
  onCopyDraftScreenshot,
  onDeleteDraft,
  onPrefillFromNote,
  onSaveDraft,
  onDiscardDraft,
  onUploadImage,
}: {
  busyAction: BusyAction | null
  copiedDraftId: string | null
  copiedDraftScreenshotId: string | null
  draftScreenshotCounts: Record<string, number>
  drafts: Draft[]
  sessionTitle?: string | null
  notice: string | null
  error: string | null
  isBusy: boolean
  activeGenerationJob: GenerationJobStatus | null
  initialSelectedRecordId?: string | null
  loadState?: RecordLoadState
  loadError?: string | null
  onRetryLoad?: () => void
  updateLocalDraft: (id: string, patch: Partial<Pick<Draft, 'title' | 'body' | 'bodyJson' | 'bodyFormat'>>) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopyDraft: (draft: Draft) => Promise<void>
  onCopyDraftScreenshot: (draft: Draft) => Promise<void>
  onDeleteDraft: (draft: Draft) => void
  onPrefillFromNote: () => Promise<void>
  onSaveDraft: (draft: Draft) => Promise<boolean>
  onDiscardDraft: (draft: Draft) => void
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  return (
    <RecordCollectionView
      labels={testwareLabels}
      emptyIcon={Box}
      prefillBusyAction="prefill-testware"
      busyAction={busyAction}
      copiedRecordId={copiedDraftId}
      copiedRecordScreenshotId={copiedDraftScreenshotId}
      recordScreenshotCounts={draftScreenshotCounts}
      records={drafts}
      sessionTitle={sessionTitle}
      notice={notice}
      error={error}
      isBusy={isBusy}
      activeGenerationJob={activeGenerationJob}
      initialSelectedRecordId={initialSelectedRecordId}
      loadState={loadState}
      loadError={loadError}
      onRetryLoad={onRetryLoad}
      renderListMeta={(draft) => <TestwareGenerationBadges draft={draft} />}
      renderPreviewHeader={(draft) => (
        <div className="record-heading-row">
          <h2 className="record-title">{draft.title}</h2>
          <TestwareGenerationBadges draft={draft} />
        </div>
      )}
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
      onPrefillFromNote={onPrefillFromNote}
      onSaveRecord={onSaveDraft}
      onDiscardRecord={onDiscardDraft}
      onUploadImage={onUploadImage}
    />
  )
}

function TestwareGenerationBadges({ draft }: { draft: Draft }) {
  const metadata = parseTestwareGenerationMetadata(draft)
  if (!metadata) return null

  return (
    <div className="testware-metadata-badges" aria-label="Testware generation settings">
      <span>{testwareTechniqueLabel(metadata.technique)}</span>
      <span>{testwareDepthLabel(metadata.depth)}</span>
      <span>{testwareOutputFormatLabel(metadata.outputFormat)}</span>
    </div>
  )
}
