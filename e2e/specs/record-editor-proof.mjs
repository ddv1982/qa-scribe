export async function attachRecordProofImage() {
  await browser.execute(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const context = canvas.getContext('2d')
    context.fillStyle = '#2456c4'
    context.fillRect(0, 0, 32, 32)
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), char => char.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], 'checkout-evidence.png', { type: 'image/png' }))
    const editor = document.querySelector('.editable-record [contenteditable="true"]')
    editor.focus()
    const input = document.querySelector('.editable-record [aria-label="Upload image file"]')
    input.addEventListener('click', event => event.preventDefault(), { once: true })
    document.querySelector('.editable-record [aria-label="Upload image"]').click()
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

export async function scrollRecordToEnd() {
  await browser.execute(() => {
    const workspace = document.querySelector('.editable-record')?.closest('.collection-view')
    if (!workspace) throw new Error('The record scroll container is missing')
    workspace.scrollTop = workspace.scrollHeight
  })
}
