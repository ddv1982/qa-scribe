# Native attachment validation fixture

Linux QA fixture for plan-02a / REV-002, preserved here so independent review can inspect every assertion and the production runner selection. This is validation input, not a production API or lifecycle sidecar. The temporary runner verifies that its three executed files match these exact contents before it builds or runs anything.

Command: `node /tmp/opencode/qa-scribe-attachment-run.mjs` from the repository root on this host. To recreate the fixture, save the three fenced modules to the named files in `/tmp/opencode`. Paths below describe the checkout used for this observation. Other checkouts must adapt those paths and make the same changes in the reviewed snapshot before running.

The existing `runE2e` builds the actual isolated frontend and Tauri binary, configures temporary application data/provider fixtures, captures WDIO results, and propagates nonzero failure status. The override changes only its WDIO configuration path. No command or store is mocked. The config inherits the repository's embedded-driver setup and replaces only the spec list.

## qa-scribe-attachment-run.mjs

```js
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { runE2e } from '/home/vriesd/projects/qa-scribe/scripts/run-e2e.mjs'
const snapshot = readFileSync('/home/vriesd/projects/qa-scribe/frontend/src/test/attachment-native-validation.md', 'utf8')
for (const name of ['qa-scribe-attachment-run.mjs', 'qa-scribe-attachment-wdio.mjs', 'qa-scribe-attachment.e2e.mjs']) {
  assert.ok(snapshot.includes(readFileSync(`/tmp/opencode/${name}`, 'utf8').trim()), `${name} must match the reviewed snapshot`)
}
console.log('Native attachment runner/config/spec match the workspace review snapshot.')
const status = runE2e({ ...process.env, QA_SCRIBE_E2E_SCENARIO: 'clipboard' }, {
  spawnSyncImpl(command, args, options) {
    if (args[0] === 'run' && args[1]?.endsWith('/e2e/wdio.conf.mjs')) {
      return spawnSync(command, ['run', '/tmp/opencode/qa-scribe-attachment-wdio.mjs'], options)
    }
    return spawnSync(command, args, options)
  },
})
process.exitCode = status
```

## qa-scribe-attachment-wdio.mjs

```js
import { config } from '/home/vriesd/projects/qa-scribe/e2e/wdio.conf.mjs'
export const configWithImage = { ...config, specs: ['/tmp/opencode/qa-scribe-attachment.e2e.mjs'] }
export { configWithImage as config }
```

## qa-scribe-attachment.e2e.mjs

```js
import assert from 'node:assert/strict'

async function waitSaved() {
  await browser.waitUntil(() => browser.execute(() =>
    document.querySelector('p.status-pill.saved')?.textContent?.includes('Note saved') ?? false))
}

describe('native attachment import, preview, copy and reopen', () => {
  it('persists a pasted PNG and preserves clipboard pixels through native workers', async () => {
    await (await $('button=New Session')).waitForClickable()
    await (await $('button=New Session')).click()
    await (await $('[aria-label="Session title"]')).setValue('Native image evidence')
    await (await $('[aria-label="Note body"]')).setValue('Screenshot source.')
    await waitSaved()
    const source = await browser.execute(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      canvas.getContext('2d').fillStyle = '#ff0000'
      canvas.getContext('2d').fillRect(0, 0, 1, 1)
      const dataUrl = canvas.toDataURL('image/png')
      const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (char) => char.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }))
      const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
      editor.focus()
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
      return dataUrl
    })
    const screenshot = await $('[aria-label="Note body"] img[data-attachment-id]')
    await screenshot.waitForDisplayed()
    await waitSaved()
    const attachmentId = await screenshot.getAttribute('data-attachment-id')
    const preview = await browser.tauri.execute(({ core }, id) =>
      core.invoke('get_attachment_preview_data_url', { attachmentId: id }), attachmentId)
    assert.equal(preview, source)
    await (await $('[aria-label="Copy note screenshot for Jira"]')).click()
    await $('[aria-label="Note screenshot copied for Jira"]').waitForDisplayed()
    const clipboard = await browser.tauri.execute(({ core }) => core.invoke('read_clipboard_image_data_url'))
    const pixels = await browser.execute(async (dataUrl) => {
      const image = new Image()
      image.src = dataUrl
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return { width: canvas.width, height: canvas.height, rgba: Array.from(context.getImageData(0, 0, 1, 1).data) }
    }, clipboard)
    assert.deepEqual(pixels, { width: 1, height: 1, rgba: [255, 0, 0, 255] })
    await (await $('button=New Session')).click()
    await (await $('[aria-label="Session title"]')).setValue('Image alternate')
    await (await $('[aria-label="Note body"]')).setValue('Alternate Session.')
    await waitSaved()
    await (await $('[role="option"]*=Native image evidence')).click()
    const reopened = await $('[aria-label="Note body"] img[data-attachment-id]')
    await reopened.waitForDisplayed()
    assert.equal(await reopened.getAttribute('data-attachment-id'), attachmentId)
  })
})
```

The native clipboard is shared desktop state, so run this fixture serially. It validates image import, preview bytes, native copy/readback pixels and Session reopen on Linux. It does not prove sandboxing, pixel behavior on other platforms or immunity to concurrent external filesystem replacement.
