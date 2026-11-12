import type { ReactNode } from 'react'

/** A small status label: a quiet pill for a short fact such as a format, a timebox or a state. */
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>
}
