// frontend/driver-pwa/components/trip/__tests__/DriverSubstitutionCard.test.tsx
//
// FP-83 T1: the collection card states the arrangement exactly as the server does — both
// roles, saved-but-blocked, truthful identity — and offers no live trip context once the
// arrangement is cancelled. Rendered from Ciaran's shared fixture pack.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import { DriverSubstitutionCard } from '../DriverSubstitutionCard'

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }))

const mockFetchContext = vi.fn()
vi.mock('@/lib/api/driver-substitutions', () => ({
  fetchDriverSubstitutionContext: (...args: unknown[]) => mockFetchContext(...args),
}))

const incomingPending = pack.incomingPendingNoActiveTrip.pending[0]
const legacyExchange = incomingPending.exchange
if (legacyExchange === null) throw new Error('Legacy fixture requires its recorded exchange')

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchContext.mockResolvedValue(pack.contextWithFindings)
})

describe('DriverSubstitutionCard', () => {
  it('test_incoming_driver_sees_collection_details_and_the_outgoing_contact', () => {
    render(<DriverSubstitutionCard request={incomingPending} role="incoming" />)

    expect(screen.getByText('Collect this trip')).toBeInTheDocument()
    expect(screen.getByText(incomingPending.trip_reference)).toBeInTheDocument()
    expect(screen.getByText(legacyExchange.label)).toBeInTheDocument()
    expect(screen.getByText(legacyExchange.instructions)).toBeInTheDocument()
    expect(screen.getByText(incomingPending.outgoing.full_name)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /\+27/ })).toHaveAttribute('href', `tel:${incomingPending.outgoing.phone_number}`)
    expect(screen.getByText(incomingPending.vehicles.map((v) => v.registration).join(' · '))).toBeInTheDocument()
    expect(screen.getByText('Waiting for your handover check')).toBeInTheDocument()
  })

  it('test_outgoing_driver_sees_who_takes_over', () => {
    render(<DriverSubstitutionCard request={pack.outgoingPending} role="outgoing" />)

    expect(screen.getByText('Hand over this trip')).toBeInTheDocument()
    expect(screen.getByText('Taking over')).toBeInTheDocument()
    expect(screen.getByText(pack.outgoingPending.incoming.full_name)).toBeInTheDocument()
  })

  it('test_exchange_point_offers_directions_to_its_coordinates', () => {
    render(<DriverSubstitutionCard request={incomingPending} role="incoming" />)

    const { latitude, longitude } = legacyExchange
    expect(screen.getByRole('link', { name: /Directions/ })).toHaveAttribute(
      'href',
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${latitude},${longitude}`)}`,
    )
  })

  it('test_saved_but_blocked_says_the_check_is_kept_and_why', () => {
    render(<DriverSubstitutionCard request={pack.savedButBlocked} role="incoming" />)

    expect(screen.getByText('Saved, waiting on dispatch')).toBeInTheDocument()
    expect(screen.getByText(/Your check is saved\. .*identity is not verified/)).toBeInTheDocument()
    expect(screen.queryByText('Handover complete')).not.toBeInTheDocument()
  })

  it('test_identity_is_the_recorded_status_not_a_fresh_check', () => {
    render(<DriverSubstitutionCard request={pack.identityFailed} role="incoming" />)

    expect(screen.getByText(/Identity verification failed/)).toBeInTheDocument()
  })

  it('test_details_load_remaining_stops_and_findings_on_demand', async () => {
    render(<DriverSubstitutionCard request={pack.oneConfirmation} role="incoming" />)
    expect(mockFetchContext).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Trip details' }))

    await waitFor(() => expect(screen.getByLabelText('Remaining stops')).toBeInTheDocument())
    expect(mockFetchContext).toHaveBeenCalledWith(pack.oneConfirmation.trip_id, pack.oneConfirmation.id)
    expect(screen.getByText(pack.contextWithFindings.findings[0].description)).toBeInTheDocument()
  })

  it('test_details_failure_is_reported_not_blank', async () => {
    mockFetchContext.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<DriverSubstitutionCard request={pack.oneConfirmation} role="incoming" />)

    fireEvent.click(screen.getByRole('button', { name: 'Trip details' }))

    expect(await screen.findByText(/Could not load the trip details/)).toBeInTheDocument()
  })

  it('test_cancelled_snapshot_offers_no_live_trip_context', () => {
    render(<DriverSubstitutionCard request={pack.cancelled} role="incoming" />)

    expect(screen.getByText('Handover cancelled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Trip details' })).not.toBeInTheDocument()
    expect(mockFetchContext).not.toHaveBeenCalled()
  })

  it('test_replaced_arrangement_says_so', () => {
    render(<DriverSubstitutionCard request={pack.replaced.old} role="incoming" />)

    expect(screen.getByText('Replaced by a new arrangement')).toBeInTheDocument()
  })
})

it('pending_card_renders_real_button', () => {
  render(<DriverSubstitutionCard request={incomingPending} role="incoming" />)
  expect(screen.getAllByRole('link', { name: /Record your takeover check/ })).toHaveLength(1)
})
