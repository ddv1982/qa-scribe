import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentCleanupStatus } from '../tauri'
import { AttachmentCleanupWarning } from './AttachmentCleanupWarning'
import { useAttachmentCleanup } from './useAttachmentCleanup'

const tauriMock = vi.hoisted(() => ({ retryAttachmentCleanup: vi.fn() }))
vi.mock('../tauri', () => tauriMock)

function Surface({ busy = false }: { busy?: boolean }) {
  const cleanup = useAttachmentCleanup(busy)
  return <AttachmentCleanupWarning cleanup={cleanup} />
}

function deferredStatus() {
  let resolve!: (status: AttachmentCleanupStatus) => void
  const promise = new Promise<AttachmentCleanupStatus>((next) => { resolve = next })
  return { promise, resolve }
}

describe('attachment cleanup status and retry surface', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    tauriMock.retryAttachmentCleanup.mockResolvedValue({ pendingFiles: 0 })
  })
  afterEach(cleanup)

  it('discovers pending files once and hides the warning after a successful retry', async () => {
    tauriMock.retryAttachmentCleanup.mockResolvedValueOnce({ pendingFiles: 2 })
    render(<Surface />)
    expect(await screen.findByText('Attachment cleanup pending: 2 files from deleted Sessions.')).toBeInTheDocument()
    expect(tauriMock.retryAttachmentCleanup).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry attachment cleanup' }))
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Attachment cleanup' })).not.toBeInTheDocument())
    expect(tauriMock.retryAttachmentCleanup).toHaveBeenCalledTimes(2)
  })

  it('retains the pending count and retry action when a retry rejects', async () => {
    tauriMock.retryAttachmentCleanup.mockResolvedValueOnce({ pendingFiles: 3 })
    render(<Surface />)
    await screen.findByText('Attachment cleanup pending: 3 files from deleted Sessions.')
    tauriMock.retryAttachmentCleanup.mockRejectedValueOnce(new Error('Cleanup database unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry attachment cleanup' }))
    expect(await screen.findByText(/Attachment cleanup retry failed:.*Cleanup database unavailable/)).toBeInTheDocument()
    expect(screen.getByText('Attachment cleanup pending: 3 files from deleted Sessions.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry attachment cleanup' })).toBeEnabled()
  })

  it('offers retry when initial discovery fails without a known count', async () => {
    tauriMock.retryAttachmentCleanup.mockRejectedValueOnce(new Error('Initial cleanup unavailable'))
    render(<Surface />)
    expect(await screen.findByText(/Attachment cleanup status is unavailable/)).toBeInTheDocument()
    expect(screen.getByText(/Initial cleanup unavailable/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry attachment cleanup' })).toBeEnabled()
  })

  it('surfaces null status and preserves the last known pending count', async () => {
    tauriMock.retryAttachmentCleanup.mockResolvedValueOnce({ pendingFiles: 4 })
    render(<Surface />)
    await screen.findByText('Attachment cleanup pending: 4 files from deleted Sessions.')
    tauriMock.retryAttachmentCleanup.mockResolvedValueOnce({ pendingFiles: null })
    fireEvent.click(screen.getByRole('button', { name: 'Retry attachment cleanup' }))
    expect(await screen.findByText(/Attachment cleanup status is unavailable/)).toBeInTheDocument()
    expect(screen.getByText('Last known pending files: 4.')).toBeInTheDocument()
  })

  it('does not let a late initial response overwrite a committed deletion status', async () => {
    const initial = deferredStatus()
    tauriMock.retryAttachmentCleanup.mockReturnValueOnce(initial.promise)
    const { result } = renderHook(() => useAttachmentCleanup(false))
    await waitFor(() => expect(tauriMock.retryAttachmentCleanup).toHaveBeenCalledTimes(1))
    act(() => result.current.acceptStatus({ pendingFiles: 2 }))
    await act(async () => { initial.resolve({ pendingFiles: 0 }); await initial.promise })
    expect(result.current.status).toEqual({ pendingFiles: 2 })
    expect(result.current.lastKnownPendingFiles).toBe(2)
    expect(result.current.retrying).toBe(false)
  })

  it('disables manual retry while the app is busy or a retry is in flight', async () => {
    tauriMock.retryAttachmentCleanup.mockResolvedValueOnce({ pendingFiles: 1 })
    const surface = render(<Surface busy />)
    const button = await screen.findByRole('button', { name: 'Retry attachment cleanup' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(tauriMock.retryAttachmentCleanup).toHaveBeenCalledTimes(1)
    surface.rerender(<Surface />)
    const retry = deferredStatus()
    tauriMock.retryAttachmentCleanup.mockReturnValueOnce(retry.promise)
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Retrying attachment cleanup…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retrying attachment cleanup…' }))
    expect(tauriMock.retryAttachmentCleanup).toHaveBeenCalledTimes(2)
    await act(async () => { retry.resolve({ pendingFiles: 0 }); await retry.promise })
    expect(screen.queryByRole('status', { name: 'Attachment cleanup' })).not.toBeInTheDocument()
  })
})
