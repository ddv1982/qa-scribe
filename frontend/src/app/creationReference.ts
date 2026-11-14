import { useState } from 'react'
import type { StoredRichBody } from '../editor/editorDocument'
import type { CreationKind } from '../tauri'

/** A saved test case or Finding that can show beside a new draft in place of the Note. */
export type ReferenceRecord = StoredRichBody & { id: string; title: string }
export type ReferenceRecords = Record<CreationKind, ReadonlyArray<ReferenceRecord>>
/** What shows beside the draft: the Note, or a saved record of either kind. */
export type CreationReference = { kind: 'note' } | { kind: CreationKind; id: string }

export const noteReference: CreationReference = { kind: 'note' }
export const kindLabels: Record<CreationKind, { group: string; one: string }> = {
  testware: { group: 'Test cases', one: 'test case' },
  finding: { group: 'Findings', one: 'Finding' },
}
export const referenceValue = (reference: CreationReference) => reference.kind === 'note' ? 'note' : `${reference.kind}:${reference.id}`

/** What shows beside each draft, kept per draft: a new draft starts with the Note. */
export function useCreationReference(draftId: string | null): [CreationReference, (reference: CreationReference) => void] {
  const [chosen, setChosen] = useState<{ draftId: string; reference: CreationReference } | null>(null)
  const reference = chosen && chosen.draftId === draftId ? chosen.reference : noteReference
  return [reference, (next) => { if (draftId) setChosen({ draftId, reference: next }) }]
}

/** The saved record a reference names, or null for the Note or a record that is gone. */
export function referencedRecord(reference: CreationReference, records: ReferenceRecords) {
  return reference.kind === 'note' ? null : records[reference.kind].find(record => record.id === reference.id) ?? null
}

/** Names what the panel shows: the Note, or the kind of record it shows. */
export function referenceLabel(reference: CreationReference, records: ReferenceRecords): string {
  return reference.kind !== 'note' && referencedRecord(reference, records) ? kindLabels[reference.kind].one : 'Note'
}
