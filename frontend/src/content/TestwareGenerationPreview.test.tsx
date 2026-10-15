import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenerationRecord } from '../views/RichRecordView'
import type { GenerationJobStatus } from '../tauri'
import * as tauri from '../tauri'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const job: GenerationJobStatus = { jobId: 'job', sessionId: 'session', action: 'testware', state: 'running', aiRunId: null, errorMessage: null, progressMessage: 'Generating', partialText: '' }
const html = '<h2>Requirements</h2><p><strong>Important</strong> <em>context</em> **literal** _name_ `code` [label](url) &amp; entities</p><ol start="7"><li><p>Seventh</p></li></ol><ul><li><p>Parent</p><ul><li><p>Nested</p></li></ul></li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Verified</p></li></ul>'

function preview(current: GenerationJobStatus, cancel = vi.fn(async () => {})) {
  return <GenerationRecord title="Generating Testware" titleAriaLabel="Generated title" bodyAriaLabel="Generated content" placeholder="Waiting" job={current} onCancelGenerationJob={cancel} />
}

describe('Testware generation Streamdown preview', () => {
  it('uses Streamdown for live Testware while preserving canonical HTML semantics and literal text', async () => {
    const { container } = render(preview({ ...job, partialText: html }))
    const region = screen.getByRole('region', { name: 'Generated content' })
    expect(region).toHaveAttribute('data-renderer', 'streamdown')
    await waitFor(() => expect(region.querySelector('h2')).toHaveTextContent('Requirements'))
    expect(region.querySelector('strong')).toHaveTextContent('Important')
    expect(region.querySelector('em')).toHaveTextContent('context')
    expect(region).toHaveTextContent('**literal** _name_ `code` [label](url) & entities')
    expect(region.querySelector('ol')).toHaveAttribute('start', '7')
    expect(region.querySelector('ul ul')).toHaveTextContent('Nested')
    expect(region.querySelector('input[type="checkbox"]')).toBeChecked()
    expect(region.querySelector('input[type="checkbox"]')).toBeDisabled()
    expect(container.querySelector('.tiptap')).toBeNull()
  })

  it('updates incomplete HTML, keeps progress literal, and retains cancellation controls', async () => {
    const cancel = vi.fn(async () => {})
    const { rerender } = render(preview({ ...job, progressMessage: '<strong>Starting</strong>' }, cancel))
    expect(screen.getByRole('region', { name: 'Generated content' })).toHaveTextContent('<strong>Starting</strong>')
    for (const partialText of ['<h2>Req', '<h2>Requirements</h2><p>Some <strong>imp', html]) {
      rerender(preview({ ...job, partialText }, cancel))
      await waitFor(() => expect(screen.getByRole('region', { name: 'Generated content' })).toHaveTextContent(/Req/))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalledWith('job')
    rerender(preview({ ...job, state: 'cancelling', partialText: html }, cancel))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('keeps scripts, unsafe links and remote images inert without losing safe links or escaped tags', async () => {
    const unsafe = '<p>&lt;img src="https://example.test/literal"&gt; <a href="https://example.test/check">Safe</a><a href="javascript:alert(1)">Unsafe</a></p><img src="https://example.test/tracker" alt="Remote evidence"><script>alert(1)</script><p onclick="alert(1)">End</p>'
    render(preview({ ...job, partialText: unsafe }))
    const region = screen.getByRole('region', { name: 'Generated content' })
    await waitFor(() => expect(region).toHaveTextContent('End'))
    expect(region).toHaveTextContent('<img src="https://example.test/literal">')
    expect(region.querySelector('a[href="https://example.test/check"]')).toHaveTextContent('Safe')
    expect(region.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(region.querySelector('img[src^="http"]')).toBeNull()
    expect(region).toHaveTextContent('Remote evidence')
    expect(region.querySelector('script, [onclick]')).toBeNull()
  })

  it('leaves non-Testware generation on its existing editor', () => {
    const { container } = render(preview({ ...job, action: 'findings', partialText: html }))
    expect(container.querySelector('[data-renderer="streamdown"]')).toBeNull()
    expect(container.querySelector('.rich-editor h2')).toHaveTextContent('Requirements')
  })

  it('hydrates managed Evidence through the native boundary and discards late results after Session changes', async () => {
    let finishOld: (value: string) => void = () => {}
    const load = vi.spyOn(tauri, 'getAttachmentPreviewDataUrl').mockImplementation((id) => id === 'old-image'
      ? new Promise((resolve) => { finishOld = resolve })
      : Promise.resolve('data:image/png;base64,new-image'))
    const { rerender } = render(preview({ ...job, partialText: '<p>Evidence</p><img src="qa-scribe-attachment://old-image" alt="Old evidence">' }))
    await waitFor(() => expect(load).toHaveBeenCalledWith('old-image'))
    rerender(preview({ ...job, sessionId: 'other-session', jobId: 'other-job', partialText: '<p>New</p><img src="qa-scribe-attachment://new-image" alt="New evidence">' }))
    await waitFor(() => expect(screen.getByAltText('New evidence')).toHaveAttribute('src', 'data:image/png;base64,new-image'))
    finishOld('data:image/png;base64,old-image')
    await waitFor(() => expect(screen.queryByAltText('Old evidence')).toBeNull())
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByAltText('New evidence')).toHaveAttribute('data-attachment-id', 'new-image')
  })
})
