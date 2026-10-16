import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

export async function viewport() {
  return browser.execute(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }))
}

export async function settledViewport() {
  // Use native window resizing, not DOM/CSS emulation.
  await browser.pause(250)
  let previous
  let stable = 0
  let actual
  await browser.waitUntil(async () => {
    actual = await viewport()
    stable = previous?.width === actual.width && previous?.height === actual.height ? stable + 1 : 0
    previous = actual
    return stable >= 3
  }, { timeout: 5_000, interval: 100, timeoutMsg: 'Preflight harness: native viewport did not settle' })
  return actual
}

export function nativeKeySender(evidence, persist, Key) {
  assert.equal(process.platform, 'linux', 'Native keyboard evidence requires Linux/X11')
  assert.ok(process.env.DISPLAY, 'Native keyboard evidence requires DISPLAY (use isolated Xvfb)')
  const run = (...args) => execFileSync('xdotool', args, {
    encoding: 'utf8', timeout: 5_000, shell: false,
  }).trim()
  const visible = run('search', '--onlyvisible', '--name', '.*').split(/\s+/).filter(Boolean)
    .map((id) => ({ id, name: run('getwindowname', id) }))
  evidence.visibleWindows = visible
  persist()
  const windows = visible.filter((window) => /^QA Scribe E2E(?: \(dev\))?$/.test(window.name)).map((window) => window.id)
  evidence.nativeKeyboard = { status: 'running', backend: 'xdotool', display: process.env.DISPLAY, windows, keys: [] }
  persist()
  assert.equal(windows.length, 1, `Native keys require exactly one visible QA Scribe E2E window: ${JSON.stringify(visible)}`)
  const [id] = windows
  assert.match(id, /^\d+$/, 'xdotool must return a numeric window ID')
  evidence.nativeKeyboard.window = { id, pid: run('getwindowpid', id), name: run('getwindowname', id) }
  persist()
  return async (key) => {
    const keys = { [Key.PageDown]: 'Next', [Key.PageUp]: 'Prior', [Key.Tab]: 'Tab',
      [Key.Space]: 'space', [Key.Escape]: 'Escape', [Key.Home]: 'Home',
      [Key.End]: 'End', [Key.ArrowDown]: 'Down', [Key.Enter]: 'Return', 'Shift+Tab': 'shift+Tab' }
    assert.ok(keys[key], `Unsupported native key: ${key}`)
    // Focus the actual application, not the WDIO worker PID. No --window on
    // key: XTEST must deliver real OS events, not XSendEvent to an arbitrary ID.
    assert.equal(run('getwindowname', id), evidence.nativeKeyboard.window.name)
    run('windowfocus', '--sync', id)
    assert.equal(run('getwindowfocus'), id, 'Native keys must target the selected application window')
    run('key', '--clearmodifiers', keys[key])
    evidence.nativeKeyboard.keys.push({ key: keys[key], window: id })
    persist()
    await browser.pause(100)
  }
}
