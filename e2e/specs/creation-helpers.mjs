/** The inline generation setup of a new draft in Generate mode. */
export const creationGenerateSetup = '.creation-composer .creation-generate'

/** Opens a new draft of this kind, if none is open, and switches it to Generate. Returns the switch option. */
export async function openCreationAi(kind) {
  const label = kind === 'finding' ? 'Create finding' : 'Create test cases'
  const composer = await $(`.creation-composer[aria-label="${kind === 'finding' ? 'New finding' : 'New test cases'}"]`)
  if (!await composer.isExisting()) {
    const create = await $(`button=${label}`)
    await create.waitForClickable()
    await create.click()
  }
  const option = await (await $('[role="group"][aria-label="How to create"]')).$('button=Generate')
  await option.waitForClickable()
  if (await option.getAttribute('aria-pressed') !== 'true') await option.click()
  await $(creationGenerateSetup).waitForDisplayed()
  return option
}

/** Switches the open draft back to Write, where its fields are as they were left. */
export async function returnToWrite() {
  const option = await (await $('[role="group"][aria-label="How to create"]')).$('button=Write')
  await option.waitForClickable()
  await option.click()
  await $(creationGenerateSetup).waitForExist({ reverse: true })
}

/** Clicks Generate mode's primary action ("Generate", or "Generate and replace draft" for an authored draft). */
export async function confirmCreationAi(label = 'Generate') {
  // The Write | Generate switch shares this row; its Generate option is not the action.
  const action = await (await $('.creation-composer .record-actions')).$(`./button[normalize-space()="${label}"]`)
  await action.waitForClickable()
  await action.click()
  return action
}
