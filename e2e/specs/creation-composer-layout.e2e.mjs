import assert from 'node:assert/strict'
import { readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { capture, click, create, fill, fixture, native, receipt, resize, rows, save, tab } from './composer-proof.mjs'
import { openCreationAi } from './creation-helpers.mjs'
import { assertStructure, inspect } from './preflight-layout-geometry.mjs'

describe('Destination AI setup at the approved native widths', () => {
  before(async () => {
    await $('button=New Session').waitForClickable()
    await click('button=New Session')
    await fill('[aria-label="Session title"]', 'Composer responsive AI setup')
    await fill('[aria-label="Note body"]', 'Canonical source to review before explicitly generating. Preserve cancellation and saved-result semantics.')
    await browser.waitUntil(async () => {
      const sessions = await native('list_sessions')
      const session = sessions.find(session => session.title === 'Composer responsive AI setup')
      return session && (await native('list_entries', { sessionId: session.id })).some(entry => entry.body.includes('Canonical source to review'))
    })
  })
  for (const kind of ['finding', 'testware']) {
    it(`keeps ${kind} source, execution controls and actions reachable in both themes`, async () => {
      const before = rows()
      for (const theme of ['light', 'dark']) {
        await resize(1280)
        await click('button=Settings')
        await click(`button=${theme === 'light' ? 'Light' : 'Dark'}`)
        await click('button=Back')
        await tab(kind === 'finding' ? 'Findings' : 'Test cases')
        await create(kind)
        await fill(`[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`, 'Authored draft retained when setup closes')
        for (const width of [1280, 1024, 768, 360, 320]) {
          await resize(width)
          await openCreationAi(kind)
          await browser.executeAsync(done => Promise.all(document.querySelector('dialog[open]').getAnimations().map(animation => animation.finished.catch(() => {}))).then(() => done()))
          const geometry = await inspect()
          receipt(`ai-${kind}-${theme}-${width}`, { geometry, rows: rows() })
          assertStructure(geometry)
          for (const control of await $$('dialog[open] .confirmation-actions button')) {
            await control.scrollIntoView()
            assert.ok(await control.isDisplayed())
          }
          await capture(`uc2-ai-${kind}-${theme}-${width}`)
          await click('dialog button=Cancel')
          assert.equal(await $(`[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`).getValue(), 'Authored draft retained when setup closes')
        }
        await resize(1280)
        await click('button=Cancel')
        await click('button=Discard draft')
      }
      assert.deepEqual(rows(), before)
    })
  }
  it('explains an unavailable provider inside setup while ordinary Save remains available', async () => {
    const link = join(fixture, 'bin/codex')
    const target = readlinkSync(link)
    unlinkSync(link)
    try {
      await browser.refresh()
      await $('h1=Test cases').waitForDisplayed()
      await tab('Findings')
      await create('finding')
      await fill('[aria-label="Finding title"]', 'No provider required for ordinary Save')
      await openCreationAi('finding')
      await browser.waitUntil(() => browser.execute(() => Array.from(document.querySelectorAll('dialog[open] [role="alert"]')).some(node => node.textContent.includes('unavailable'))))
      assert.equal(await (await $('dialog[open]')).$('button=Generate and replace draft').isEnabled(), false)
      assert.equal(await (await $('dialog[open]')).$('button=Configure AI execution…').isEnabled(), true)
      await capture('uc2-ai-unavailable-inside-setup')
      await click('dialog button=Cancel')
      await save('finding')
      assert.equal(rows().ai_runs, 0)
      assert.equal(rows().generation_contexts, 0)
    } finally { symlinkSync(target, link) }
  })
})
