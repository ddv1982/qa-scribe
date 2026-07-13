import { useState } from 'react'
import type { GenerateAiActionKind, GenerationJobStatus } from '../tauri'
import type { GenerationWorkspace, LatestNoteGenerationUndo } from './types'

export function useGenerationWorkspace() {
  const [generationJobs, setGenerationJobs] = useState<Record<string, GenerationJobStatus>>({})
  const [pendingGenerationAction, setPendingGenerationAction] = useState<GenerateAiActionKind | null>(null)
  const [latestNoteGenerationUndo, setLatestNoteGenerationUndo] = useState<LatestNoteGenerationUndo | null>(null)
  const workspace: GenerationWorkspace = { latestNoteGenerationUndo, setGenerationJobs, setLatestNoteGenerationUndo }

  return {
    generationJobs,
    pendingGenerationAction,
    latestNoteGenerationUndo,
    setPendingGenerationAction,
    setLatestNoteGenerationUndo,
    workspace,
  }
}
