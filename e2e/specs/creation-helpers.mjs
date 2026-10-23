export async function openCreationAi(kind) {
  const label = kind === 'finding' ? 'Create finding' : 'Create test cases'
  const composer = await $(`.creation-composer[aria-label="${kind === 'finding' ? 'New finding' : 'New test cases'}"]`)
  if (!await composer.isExisting()) {
    const create = await $(`button=${label}`)
    await create.waitForClickable()
    await create.click()
  }
  const trigger = await $('button=Generate with AI')
  await trigger.waitForClickable()
  await trigger.click()
  await $('dialog.generation-preflight[open]').waitForDisplayed()
  return trigger
}
