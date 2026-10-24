import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, type ComponentProps } from 'react'
import { SessionChatView } from './SessionChatView.testSupport'
import { chatFixture, completedChatFixture } from '../app/useSessionChat.testSupport'

vi.mock('../tauri', async original => ({ ...await original<object>(), getAttachmentPreviewDataUrl: vi.fn(async () => null) }))
afterEach(cleanup)
type Props = ComponentProps<typeof SessionChatView>
const image = { attachmentId: 'image-1', filename: 'checkout.png', mimeType: 'image/png', sizeBytes: 100 }
function props(patch: Partial<Props> = {}): Props {
  return { chat: chatFixture({ mode: 'chat' }), composer: '', composerImages: [], job: null, loading: false,
    saving: false, working: false, error: null, providerLabel: 'Codex', modelLabel: 'Default', providerAvailable: true,
    providerReason: '', onSetComposer: vi.fn(), onSend: vi.fn(async () => {}), onRetry: vi.fn(async () => {}),
    onCancel: vi.fn(async () => {}), onSubmit: vi.fn(async () => {}), onRestart: vi.fn(async () => {}),
    onConfigureAi: vi.fn(), onAttachImages: vi.fn(async () => {}), onPasteNativeImage: vi.fn(async () => {}),
    onRemoveImage: vi.fn(), ...patch }
}

describe('chat attachment controls', () => {
  it('puts the paperclip directly left of Send and enables an image-only message', () => {
    render(<SessionChatView {...props({ composerImages: [image] })} />)
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Attach images' }).nextElementSibling).toBe(send)
    expect(screen.getByRole('list', { name: 'Attached images' })).toHaveTextContent('checkout.png')
  })

  it('pastes image files and leaves ordinary text paste to the textarea', () => {
    const callbacks = props({ composer: 'Keep my message' })
    render(<SessionChatView {...callbacks} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    const file = new File(['pixels'], 'pasted.png', { type: 'image/png' })
    expect(fireEvent.paste(input, { clipboardData: { files: [file], items: [], types: ['Files'] } })).toBe(false)
    expect(callbacks.onAttachImages).toHaveBeenCalledExactlyOnceWith([file])
    expect(fireEvent.paste(input, { clipboardData: { files: [], items: [], types: ['text/plain'], getData: () => 'Ordinary text' } })).toBe(true)
    expect(callbacks.onPasteNativeImage).not.toHaveBeenCalled()
    expect(input).toHaveValue('Keep my message')
  })

  it('uses native clipboard pixels when the WebView exposes only an image type', () => {
    const callbacks = props()
    render(<SessionChatView {...callbacks} />)
    fireEvent.paste(screen.getByRole('textbox', { name: 'Message' }), {
      clipboardData: { files: [], items: [], types: ['public.tiff'], getData: () => '' },
    })
    expect(callbacks.onPasteNativeImage).toHaveBeenCalledOnce()
    expect(callbacks.onAttachImages).not.toHaveBeenCalled()
  })

  it('keeps arbitrary edited text while removing an image', () => {
    function Controlled() {
      const [composer, setComposer] = useState('Initial message')
      const [images, setImages] = useState([image])
      return <SessionChatView {...props({ composer, composerImages: images, onSetComposer: setComposer,
        onRemoveImage: id => setImages(current => current.filter(value => value.attachmentId !== id)) })} />
    }
    render(<Controlled />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: 'Keep my edited message 4827.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove checkout.png' }))
    expect(input).toHaveValue('Keep my edited message 4827.')
    expect(screen.queryByRole('list', { name: 'Attached images' })).not.toBeInTheDocument()
  })

  it('handles picker cancellation and allows choosing the same file again', () => {
    const callbacks = props()
    render(<SessionChatView {...callbacks} />)
    const input = screen.getByLabelText('Choose chat images')
    fireEvent.change(input, { target: { files: [] } })
    expect(callbacks.onAttachImages).not.toHaveBeenCalled()
    const file = new File(['pixels'], 'same.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.change(input, { target: { files: [file] } })
    expect(callbacks.onAttachImages).toHaveBeenCalledTimes(2)
    expect(input).toHaveValue('')
  })

  it('blocks Note submission and asks before restarting an image-only draft', () => {
    const callbacks = props({ chat: completedChatFixture(), composerImages: [image] })
    render(<SessionChatView {...callbacks} />)
    expect(screen.getByRole('button', { name: 'Add conversation to note' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Start new conversation' }))
    expect(screen.getByRole('dialog', { name: 'Start a new conversation?' })).toBeVisible()
    expect(callbacks.onRestart).not.toHaveBeenCalled()
  })

  it('locks attachment changes during an operation and preserves plain Enter', () => {
    const callbacks = props({ working: true, composerImages: [image], composer: 'Question' })
    render(<SessionChatView {...callbacks} />)
    expect(screen.getByRole('button', { name: 'Attach images' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove checkout.png' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter' })
    expect(callbacks.onSend).not.toHaveBeenCalled()
  })

  it('blocks Send for failed images and offers retry and removal', () => {
    const callbacks = props({ composer: 'Question', imageFailures: [{ id: 'failed-1', filename: 'large.png', message: 'Too large' }],
      onRetryImage: vi.fn(async () => {}), onDismissImageFailure: vi.fn() })
    render(<SessionChatView {...callbacks} />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(screen.getByRole('list', { name: 'Failed images' })).toHaveTextContent('large.png: Too large')
    fireEvent.click(screen.getByRole('button', { name: 'Retry large.png' }))
    expect(callbacks.onRetryImage).toHaveBeenCalledExactlyOnceWith('failed-1')
    fireEvent.click(screen.getByRole('button', { name: 'Remove failed large.png' }))
    expect(callbacks.onDismissImageFailure).toHaveBeenCalledExactlyOnceWith('failed-1')
  })

  it('labels uncertain attachments and links their removal without dropping known images or text', () => {
    const known = { ...image, attachmentId: 'known-image', filename: 'known.png' }
    const removeImage = vi.fn()
    function Controlled() {
      const [images, setImages] = useState([known, image])
      const [failures, setFailures] = useState<NonNullable<Props['imageFailures']>>([{ id: 'failed-1', filename: image.filename,
        message: 'Preview unavailable', recovery: { kind: 'verification_pending', images: [image] } }])
      return <SessionChatView {...props({ composer: 'Keep my question 4827', composerImages: images, imageFailures: failures,
        onRemoveImage: id => { removeImage(id); setImages(current => current.filter(value => value.attachmentId !== id)) },
        onDismissImageFailure: async () => { if (!images.some(value => value.attachmentId === image.attachmentId)) setFailures([]) } })} />
    }
    render(<Controlled />)
    const list = screen.getByRole('list', { name: 'Attached images' })
    expect(within(list).getByText('Verification pending').closest('li')).toHaveAttribute('data-attachment-id', 'image-1')
    expect(within(list).getByText('Ready to send').closest('li')).toHaveAttribute('data-attachment-id', 'known-image')
    expect(screen.getByRole('list', { name: 'Failed images' })).toHaveTextContent('another client')
    fireEvent.click(screen.getByRole('button', { name: 'Remove failed checkout.png' }))
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove unverified checkout.png' }))
    expect(removeImage).toHaveBeenCalledExactlyOnceWith('image-1')
    expect(screen.getByText('Removed from message')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove failed checkout.png' }))
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep my question 4827')
    expect(screen.getByRole('list', { name: 'Attached images' })).toHaveTextContent('known.png')
    expect(screen.queryByRole('button', { name: 'Remove checkout.png' })).not.toBeInTheDocument()
  })
})
