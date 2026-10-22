import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

export function assertClipboardHtml(actual, fragment, platform = process.platform) {
  const expected = platform === 'darwin'
    ? `<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head><body>${fragment}</body></html>`
    : fragment
  assert.equal(actual, expected)
}

function readClipboardCommand(command, args) {
  try {
    return execFileSync(command, args, { timeout: 5_000, encoding: 'utf8' })
  } catch (error) {
    throw new Error(`Clipboard readback failed: ${error.message}`)
  }
}

export function readClipboardText() {
  if (process.platform === 'linux') {
    const read = (target) => readClipboardCommand('xclip', ['-selection', 'clipboard', '-o', '-target', target])
    return { plain: read('UTF8_STRING'), html: read('text/html'), method: 'X11 CLIPBOARD selection via xclip UTF8_STRING and text/html' }
  }
  assert.equal(process.platform, 'darwin', 'Clipboard readback needs a supported desktop host')
  const htmlData = readClipboardCommand('osascript', ['-e', 'get the clipboard as «class HTML»']).trim()
  const hex = htmlData.match(/^«data HTML([a-f\d]+)»$/i)?.[1]
  assert.ok(hex, `AppleScript did not return an HTML clipboard flavor: ${htmlData}`)
  return { plain: readClipboardCommand('pbpaste', []), html: Buffer.from(hex, 'hex').toString('utf8'), method: 'pbpaste plain and AppleScript HTML clipboard flavor' }
}
