// frontend/driver-pwa/components/trip/__tests__/DriverParticipationHistory.test.tsx
//
// FP-83 T1: a former driver's record shows only their own part, states the trip's REAL
// status (often still Active for the next driver), and keeps an unsigned photo visible as
// a record rather than hiding it.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import type { DriverParticipationHistoryRead } from '@shared/lib/types/driver-substitution'
import { DriverParticipationHistory } from '../DriverParticipationHistory'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }))
vi.mock('@/components/layout/BottomNav', () => ({ BottomNav: () => <nav aria-label="Main navigation" /> }))

const history = pack.formerParticipantHistory.history

describe('DriverParticipationHistory', () => {
  it('test_states_the_real_trip_status_as_the_trips', () => {
    render(<DriverParticipationHistory history={history} onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Your record' })).toBeInTheDocument()
    expect(screen.getByText(/Trip status now: Active\. This shows only your part of it\./)).toBeInTheDocument()
  })

  it('test_lists_own_periods_actions_and_declarations', () => {
    render(<DriverParticipationHistory history={history} onBack={vi.fn()} />)

    expect(screen.getByText('Your time on this trip')).toBeInTheDocument()
    expect(screen.getByText('Phase recorded')).toBeInTheDocument()
    expect(screen.getByText('Your handover check')).toBeInTheDocument()
    expect(screen.getByText(/Seal intact · AB-1234/)).toBeInTheDocument()
    expect(screen.getByText(/No seal \(empty leg\)/)).toBeInTheDocument()
  })

  it('test_offers_no_live_trip_actions', () => {
    render(<DriverParticipationHistory history={history} onBack={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /Start|Continue Driving|Arrive/ })).not.toBeInTheDocument()
  })

  it('test_unsigned_photo_still_appears_as_a_record', () => {
    const unsigned: DriverParticipationHistoryRead = {
      ...history,
      artifacts: history.artifacts.map((a) => ({ ...a, signed_url: null })),
    }

    render(<DriverParticipationHistory history={unsigned} onBack={vi.fn()} />)

    expect(screen.getByText('Photo unavailable')).toBeInTheDocument()
  })

  it('test_dispatcher_attested_period_is_labelled', () => {
    const attested: DriverParticipationHistoryRead = {
      ...history,
      custody_periods: history.custody_periods.map((p) => ({ ...p, completion_mode: 'dispatcher_attested' })),
    }

    render(<DriverParticipationHistory history={attested} onBack={vi.fn()} />)

    expect(screen.getByText('Handover recorded by dispatch')).toBeInTheDocument()
  })
})
