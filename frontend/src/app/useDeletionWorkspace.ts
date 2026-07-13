import { useState } from 'react'
import type { DeleteConfirmation } from '../workflows/deleteConfirmation'
import type { DeletionWorkspace } from './types'

export function useDeletionWorkspace() {
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)
  const workspace: DeletionWorkspace = { deleteConfirmation, setDeleteConfirmation }
  return { deleteConfirmation, setDeleteConfirmation, workspace }
}
