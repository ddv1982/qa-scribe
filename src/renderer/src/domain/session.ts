import type { EntryType, SessionDraft } from '../../../shared/contracts'
import type { EntryTypeOption } from './types'

export const entryTypes: EntryTypeOption[] = [
  { value: 'note', label: 'Note' },
  { value: 'observation', label: 'Observation' },
  { value: 'api_response', label: 'API Response' },
  { value: 'log', label: 'Log' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'finding_candidate', label: 'Finding' }
]

export const emptyDraft: SessionDraft = {
  title: '',
  testTarget: '',
  charter: '',
  environment: '',
  buildVersion: '',
  relatedReference: ''
}

export function hasSessionOptionalDetails(draft: SessionDraft): boolean {
  return Boolean(draft.environment?.trim() || draft.buildVersion?.trim() || draft.relatedReference?.trim())
}

export function labelForEntryType(type: EntryType): string {
  return entryTypes.find((entryType) => entryType.value === type)?.label ?? type
}
