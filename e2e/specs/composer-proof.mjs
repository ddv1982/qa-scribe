import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { settledViewport } from './preflight-native-keys.mjs'

export const out = process.env.QA_SCRIBE_E2E_ARTIFACTS
export const fixture = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
export const database = join(process.env.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite')
const history = []
export function receipt(name, value) {
  history.push({ name, ...value })
  writeFileSync(join(out, 'composer-outcomes.json'), JSON.stringify(history, null, 2))
}
export async function state() {
  return browser.execute(() => ({ headings: Array.from(document.querySelectorAll('h1,h2'), node => node.textContent),
    buttons: Array.from(document.querySelectorAll('button'), node => ({ text: node.textContent.trim(), disabled: node.disabled })),
    focus: document.activeElement?.getAttribute('aria-label'), dialog: document.querySelector('dialog[open]')?.textContent,
    alertText: document.querySelector('[role="alert"]')?.textContent }))
}
export async function click(selector) {
  const target = selector.startsWith('dialog button=') ? await (await $('dialog[open]')).$(selector.slice(7)) : await $(selector)
  await target.waitForClickable()
  await target.click()
  receipt(selector, await state())
  return target
}
export async function tab(label) { await click(`[role="tab"]*=${label}`) }
export async function fill(selector, value) {
  const target = await $(selector)
  await target.waitForDisplayed()
  await target.setValue(value)
  receipt(`type ${selector}`, await state())
}
export async function native(command, args = {}) {
  return browser.tauri.execute(({ core }, name, input) => core.invoke(name, input), command, args)
}
export function rows() {
  return JSON.parse(execFileSync('python3', ['-c', `import sqlite3,json,sys
with sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True) as db:
 print(json.dumps({**{t:db.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['findings','drafts','attachments','creation_attempts','creation_attempt_images','generation_contexts','ai_runs']},'attemptStates':dict(db.execute('SELECT state,COUNT(*) FROM creation_attempts GROUP BY state'))}))`, database], { encoding: 'utf8', timeout: 5_000 }))
}
export async function capture(name) { await browser.saveScreenshot(join(out, `${name}.png`)); receipt(name, { rows: rows(), state: await state() }) }
export async function create(kind) {
  await click(`button=Create ${kind === 'finding' ? 'finding' : 'test cases'}`)
  await $(`[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`).waitForDisplayed()
}
export async function save(kind) {
  await click(`button=Save ${kind === 'finding' ? 'finding' : 'test cases'}`)
  await $('button=Edit').waitForDisplayed()
}
export async function imageFile() {
  return browser.execute(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1), 0, 0)
    return canvas.toDataURL('image/png')
  })
}
export async function stageImage(dataUrl, mode = 'upload') {
  const before = await browser.execute(() => document.querySelectorAll('.creation-composer img').length)
  await browser.execute((dataUrl, mode) => {
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), char => char.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], 'local-evidence.png', { type: 'image/png' }))
    if (mode === 'paste') {
      const editor = document.querySelector('[aria-label="Creation draft body"]')
      editor.focus()
      const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false)
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }
    else {
      const input = document.querySelector('.creation-composer input[type="file"]')
      input.addEventListener('click', event => event.preventDefault(), { once: true })
      document.querySelector('.creation-composer [aria-label="Upload image"]').click()
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, dataUrl, mode)
  await browser.waitUntil(() => browser.execute(before => { const images = Array.from(document.querySelectorAll('.creation-composer img')); return images.length === before + 1 && images.every(image => image.complete && image.naturalWidth > 0) }, before))
}
export async function clipboardPixels() {
  const data = await native('read_clipboard_image_data_url')
  assert.ok(data, 'Actual native clipboard must contain an image')
  return browser.execute(async data => {
    const image = new Image()
    image.src = data
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    return { width: image.width, height: image.height, rgba: Array.from(ctx.getImageData(0, 0, image.width, image.height).data) }
  }, data)
}
export async function resize(width) {
  await browser.setWindowSize(1280, 860)
  const actual = await settledViewport()
  const scale = 1280 / actual.width
  let request = { width: Math.round(width * scale), height: Math.round(800 * scale) }
  for (let attempt = 0; attempt < 5; attempt++) {
    await browser.setWindowSize(request.width, request.height)
    const current = await settledViewport()
    if (Math.abs(current.width - width) <= 2) return current
    request.width += Math.round((width - current.width) * scale)
  }
  throw new Error(`Native viewport could not reach ${width} CSS pixels`)
}
export function recordVideo() {
  const dimensions = execFileSync('xdpyinfo', [], { encoding: 'utf8', timeout: 5_000 }).match(/dimensions:\s+(\d+x\d+)/)?.[1]
  assert.ok(dimensions)
  const child = spawn('ffmpeg', ['-y', '-f', 'x11grab', '-framerate', '15', '-video_size', dimensions, '-i', process.env.DISPLAY,
    '-t', '60', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(out, 'composer-interaction.mp4')], { stdio: ['pipe', 'ignore', 'pipe'] })
  let log = ''
  child.stderr.on('data', chunk => { log += chunk })
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => { writeFileSync(join(out, 'video.log'), log); code === 0 ? resolve() : reject(new Error(`Video exit ${code}`)) }) })
  return { stop: async () => { if (child.exitCode === null && !child.stdin.destroyed) child.stdin.write('q'); await done } }
}
export async function fixtureStarted(index) {
  const { existsSync } = await import('node:fs')
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
}
