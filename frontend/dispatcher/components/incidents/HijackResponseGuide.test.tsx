import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ResponseStep, ResponseStepKey, ResponseStepState } from '@/lib/types/incident'
import { HijackResponseGuide } from './HijackResponseGuide'

const KEYS: ResponseStepKey[] = [
  'trip_stopped', 'tracking_company_alerted', 'saps_reported', 'insurer_notified',
  'client_notified', 'driver_welfare_check', 'audit_pack_issued',
]

function steps(states: Partial<Record<ResponseStepKey, ResponseStepState>> = {}): ResponseStep[] {
  return KEYS.map(key => ({ key, state: states[key] ?? 'todo', done_at: null, detail: null }))
}

function renderGuide(overrides: Partial<Parameters<typeof HijackResponseGuide>[0]> = {}) {
  const handlers = {
    onStopTrip: vi.fn(), onRecordAction: vi.fn(), onRecordSaps: vi.fn(), onAttachCaseSlip: vi.fn(),
    onIssuePack: vi.fn(), onDownloadSheet: vi.fn(),
  }
  render(<HijackResponseGuide steps={steps()} closed={false} tripLive documentUploadEnabled={false} {...handlers} {...overrides} />)
  return handlers
}

function step(name: RegExp): HTMLElement {
  return screen.getByText(name).closest('li')!
}

describe('HijackResponseGuide', () => {
  it('lists the seven steps in order', () => {
    renderGuide()

    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('1. Stop the trip'), expect.stringContaining('7. Issue the insurer audit pack'),
    ]))
  })

  it('records an external action from its step', async () => {
    const { onRecordAction } = renderGuide()

    await userEvent.click(within(step(/Alert the tracking company/)).getByRole('button', { name: 'Record' }))

    expect(onRecordAction).toHaveBeenCalledWith('tracking_company_alerted')
  })

  it('offers to stop a live trip, and nothing once it is stopped', () => {
    renderGuide({ steps: steps({ trip_stopped: 'done' }) })

    expect(within(step(/Stop the trip/)).queryByRole('button')).not.toBeInTheDocument()
    expect(within(step(/Stop the trip/)).getByText(/Done/)).toBeInTheDocument()
  })

  it('shows "attach case slip" only when the backend allows documents', () => {
    const { unmount } = render(<HijackResponseGuide steps={steps()} closed={false} tripLive documentUploadEnabled
      onStopTrip={vi.fn()} onRecordAction={vi.fn()} onRecordSaps={vi.fn()} onAttachCaseSlip={vi.fn()} onIssuePack={vi.fn()} onDownloadSheet={vi.fn()} />)
    const shownWhenOn = screen.queryByRole('button', { name: 'Attach case slip' }) !== null
    unmount()
    renderGuide({ documentUploadEnabled: false })

    expect(shownWhenOn).toBe(true)
    expect(screen.queryByRole('button', { name: 'Attach case slip' })).not.toBeInTheDocument()
  })

  it('hides every step action on a closed incident but keeps the fact sheet', () => {
    renderGuide({ closed: true })

    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download SAPS fact sheet' })).toBeInTheDocument()
  })

  describe('who vouches for a step', () => {
    const RECORDED = /Recorded by dispatcher/

    it('labels a done step that rests on the dispatcher\'s say-so', () => {
      renderGuide({ steps: steps({ client_notified: 'done' }) })

      expect(within(step(/Notify the client/)).getByText(RECORDED)).toBeInTheDocument()
    })

    it('shows the recorded time beside the label when the step has one', () => {
      const withTime = steps({ insurer_notified: 'done' }).map(s =>
        s.key === 'insurer_notified' ? { ...s, done_at: '2026-10-21T12:02:00Z' } : s)

      renderGuide({ steps: withTime })

      const row = step(/Notify the insurer/)
      expect(within(row).getByText(RECORDED)).toBeInTheDocument()
      expect(row.textContent).toMatch(/21 Oct/)
    })

    it('does not label the trip stop, which the system witnessed itself', () => {
      renderGuide({ steps: steps({ trip_stopped: 'done' }) })

      expect(within(step(/Stop the trip/)).queryByText(RECORDED)).not.toBeInTheDocument()
    })

    it('does not label the audit pack, which the system generated', () => {
      renderGuide({ steps: steps({ audit_pack_issued: 'done' }) })

      expect(within(step(/Issue the insurer audit pack/)).queryByText(RECORDED)).not.toBeInTheDocument()
    })

    it('labels nothing on a step that is not done', () => {
      renderGuide({ steps: steps({ client_notified: 'todo', driver_welfare_check: 'not_applicable' }) })

      expect(screen.queryByText(RECORDED)).not.toBeInTheDocument()
    })

    it('explains under the heading that steps are the dispatcher\'s record, not the parties\' confirmation', () => {
      renderGuide()

      expect(screen.getByText(/what the dispatcher recorded, not confirmations from the parties/i)).toBeInTheDocument()
    })
  })
})
