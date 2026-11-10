/**
 * The app mark: a "Q" ring with a highlighter tail. Geometry matches
 * `scripts/generate-app-icon.py` (and the favicon it writes); colours come from
 * theme tokens so the mark inverts with the primary button in dark mode.
 */
export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg className="brand-mark-svg" width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <rect className="brand-mark-square" x="80" y="80" width="864" height="864" rx="200" />
      <circle className="brand-mark-ring" cx="512" cy="496" r="204" fill="none" strokeWidth="104" />
      <rect className="brand-mark-tail" x="520" y="632" width="288" height="128" rx="40" />
    </svg>
  )
}
