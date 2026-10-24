import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAttachmentPreviewDataUrl } from '../tauri'
import { ChatImages } from './ChatImages'

vi.mock('../tauri', () => ({ getAttachmentPreviewDataUrl: vi.fn() }))
const preview = vi.mocked(getAttachmentPreviewDataUrl)
afterEach(() => { cleanup(); vi.resetAllMocks() })
const images = [{ attachmentId: 'image-1', filename: 'checkout.png' }]

describe('chat images', () => {
  it('loads managed pixels and lets the user inspect the image and close it', async () => {
    preview.mockResolvedValue('data:image/png;base64,cGl4ZWxz')
    render(<ChatImages images={images} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Preview checkout.png' }))
    const dialog = screen.getByRole('dialog', { name: 'checkout.png' })
    expect(dialog.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,cGl4ZWxz')
    fireEvent.click(screen.getByRole('button', { name: 'Close image preview' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('removes only the selected image and respects a locked composer', async () => {
    preview.mockResolvedValue(null)
    const remove = vi.fn()
    const view = render(<ChatImages images={images} onRemove={remove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove checkout.png' }))
    expect(remove).toHaveBeenCalledExactlyOnceWith('image-1')
    view.rerender(<ChatImages images={images} onRemove={remove} disabled />)
    expect(screen.getByRole('button', { name: 'Remove checkout.png' })).toBeDisabled()
    await screen.findByText('Preview unavailable')
  })

  it('retains the filename and supports retry after preview loading fails', async () => {
    preview.mockRejectedValueOnce(new Error('Disk busy')).mockResolvedValueOnce('data:image/png;base64,cGl4ZWxz')
    render(<ChatImages images={images} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry preview' }))
    await screen.findByRole('button', { name: 'Preview checkout.png' })
    expect(screen.getByText('checkout.png')).toBeInTheDocument()
  })

  it('does not put a late image into a replacement attachment', async () => {
    let resolve!: (url: string) => void
    preview.mockReturnValueOnce(new Promise(done => { resolve = done })).mockResolvedValueOnce('data:image/png;base64,bmV3')
    const view = render(<ChatImages images={images} />)
    view.rerender(<ChatImages images={[{ attachmentId: 'image-2', filename: 'new.png' }]} />)
    await screen.findByRole('button', { name: 'Preview new.png' })
    resolve('data:image/png;base64,b2xk')
    await waitFor(() => expect(screen.getByRole('img', { name: 'new.png' })).toHaveAttribute('src', 'data:image/png;base64,bmV3'))
    expect(screen.queryByText('checkout.png')).not.toBeInTheDocument()
  })
})
