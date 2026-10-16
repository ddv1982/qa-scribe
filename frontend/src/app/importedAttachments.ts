import { useState } from 'react'
import type { AttachmentUploadOwner } from './attachmentActions'

export type ImportedAttachments = ReturnType<typeof createImportedAttachments>

function createImportedAttachments() {
  const owners = new Map<string, Set<string>>()
  const key = (owner: AttachmentUploadOwner) => `${owner.kind}:${owner.id}`
  function remember(owner: AttachmentUploadOwner, attachmentIds: string[]) {
    if (attachmentIds.length === 0) return
    const pending = owners.get(key(owner)) ?? new Set<string>()
    for (const id of attachmentIds) pending.add(id)
    owners.set(key(owner), pending)
  }
  return {
    register: (owner: AttachmentUploadOwner, attachmentId: string) => remember(owner, [attachmentId]),
    remember,
    pending: (owner: AttachmentUploadOwner) => Array.from(owners.get(key(owner)) ?? []),
    clear: (owner: AttachmentUploadOwner) => { owners.delete(key(owner)) },
    forget: (owner: AttachmentUploadOwner, attachmentIds: string[]) => {
      const pending = owners.get(key(owner))
      if (!pending) return
      for (const id of attachmentIds) pending.delete(id)
      if (pending.size === 0) owners.delete(key(owner))
    },
  }
}

export function useImportedAttachments() {
  const [attachments] = useState(createImportedAttachments)
  return attachments
}
