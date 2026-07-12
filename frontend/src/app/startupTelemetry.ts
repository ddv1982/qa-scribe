const STARTUP_MARK_PREFIX = 'qa-scribe:startup:'

export function startupMark(name: string) {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  try {
    performance.mark(`${STARTUP_MARK_PREFIX}${name}`)
  } catch {
    // Startup marks are diagnostic only and must never affect app readiness.
  }
}

export function startupMeasure(name: string, start: string, end: string) {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return
  try {
    performance.measure(`qa-scribe startup ${name}`, `${STARTUP_MARK_PREFIX}${start}`, `${STARTUP_MARK_PREFIX}${end}`)
  } catch {
    // A missing mark should not turn instrumentation into a boot failure.
  }
}

export function markFirstPaintAfterBoot() {
  const mark = () => {
    startupMark('first-paint-after-boot')
    startupMeasure('boot-to-first-paint-after-boot', 'boot-start', 'first-paint-after-boot')
  }

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(mark)
  } else {
    window.setTimeout(mark, 0)
  }
}
