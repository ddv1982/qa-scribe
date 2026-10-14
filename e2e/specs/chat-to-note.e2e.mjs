import { runChatToNoteWorkflow } from './chat-to-note.workflow.mjs'

describe('Built application standalone Chat-to-Note', () => {
  it('persists Chat, retries cancellation, submits once into a rich Note, and explicitly generates Testware', async () => {
    const sessions = await (await $('nav[aria-label="Workspace sections"]')).$('button*=Sessions')
    if (await sessions.isExisting()) {
      await sessions.waitForClickable()
      await sessions.click()
    }
    await $('button=New Session').waitForClickable()
    await runChatToNoteWorkflow()
  }).timeout(120_000)
})
