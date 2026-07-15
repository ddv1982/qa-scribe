import { MANAGED_ATTACHMENT_PROTOCOL } from '../tauri'

export const managedAttachmentProtocol: string = MANAGED_ATTACHMENT_PROTOCOL

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

export function isSafeUrlWithProtocols(source: string, protocols: Set<string>): boolean {
  if (!source) return false
  try {
    const base = window.location.href || 'https://qa-scribe.local/'
    return protocols.has(new URL(source, base).protocol)
  } catch {
    return false
  }
}

export function managedAttachmentIdFromImage(image: HTMLImageElement): string | null {
  return image.getAttribute('data-attachment-id') || managedAttachmentIdFromSrc(image.getAttribute('src') ?? '')
}

export function managedAttachmentIdFromSrc(source: string): string | null {
  if (!source.startsWith(managedAttachmentProtocol)) return null
  return source.slice(managedAttachmentProtocol.length)
}
