import { extname, isAbsolute, join, relative, resolve } from 'node:path'

export type AttachmentStorageDestination = {
  relativePath: string
  destinationDir: string
  destination: string
  extension: string
}

export function resolveAttachmentStorageDestination(
  attachmentsRoot: string,
  sessionId: string,
  attachmentId: string,
  sourcePath: string
): AttachmentStorageDestination {
  const extension = extname(sourcePath)
  const relativePath = join(sessionId, `${attachmentId}${extension}`)
  const destinationDir = join(attachmentsRoot, sessionId)
  const destination = resolve(attachmentsRoot, relativePath)
  const resolvedRoot = resolve(attachmentsRoot)
  const relativeDestination = relative(resolvedRoot, destination)

  if (relativeDestination.startsWith('..') || isAbsolute(relativeDestination)) {
    throw new Error('Attachment destination escaped managed storage')
  }

  return { relativePath, destinationDir, destination, extension }
}

export function guessMimeType(extension: string): string | null {
  const normalized = extension.toLowerCase()
  if (normalized === '.png') return 'image/png'
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg'
  if (normalized === '.gif') return 'image/gif'
  if (normalized === '.webp') return 'image/webp'
  if (normalized === '.json') return 'application/json'
  if (normalized === '.txt' || normalized === '.log') return 'text/plain'
  return null
}

export function resolveStoredAttachmentPath(attachmentsRoot: string, relativePath: string): string {
  const resolvedRoot = resolve(attachmentsRoot)
  const resolvedPath = resolve(resolvedRoot, relativePath)
  const relativeTarget = relative(resolvedRoot, resolvedPath)

  if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
    throw new Error('Attachment path escaped managed storage')
  }

  return resolvedPath
}
