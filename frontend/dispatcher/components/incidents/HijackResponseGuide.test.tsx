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
    // Arrange / Act
    renderGuide()

    // Assert
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('1. Stop the trip'), expect.stringContaining('7. Issue the insurer audit pack'),
    ]))
  })

  it('records an external action from its step', async () => {
    // Arrange
    const { onRecordAction } = renderGuide()

    // Act
    await userEvent.click(within(step(/Alert the tracking company/)).getByRole('button', { name: 'Record' }))

    // Assert
    expect(onRecordAction).toHaveBeenCalledWith('tracking_company_alerted')
  })

  it('offers to stop a live trip, and nothing once it is stopped', () => {
    // Arrange / Act
    renderGuide({ steps: steps({ trip_stopped: 'done' }) })

    // Assert
    expect(within(step(/Stop the trip/)).queryByRole('button')).not.toBeInTheDocument()
    expect(within(step(/Stop the trip/)).getByText(/Done/)).toBeInTheDocument()
  })

  it('shows "attach case slip" only when the backend allows documents', () => {
    // Arrange / Act
    const { unmount } = render(<HijackResponseGuide steps={steps()} closed={false} tripLive documentUploadEnabled
      onStopTrip={vi.fn()} onRecordAction={vi.fn()} onRecordSaps={vi.fn()} onAttachCaseSlip={vi.fn()} onIssuePack={vi.fn()} onDownloadSheet={vi.fn()} />)
    const shownWhenOn = screen.queryByRole('button', { name: 'Attach case slip' }) !== null
    unmount()
    renderGuide({ documentUploadEnabled: false })

    // Assert
    expect(shownWhenOn).toBe(true)
    expect(screen.queryByRole('button', { name: 'Attach case slip' })).not.toBeInTheDocument()
  })

  it('hides every step action on a closed incident but keeps the fact sheet', () => {
    // Arrange / Act
    renderGuide({ closed: true })

    // Assert
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download SAPS fact sheet' })).toBeInTheDocument()
  })
})
