import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockPrecincts, PRECINCT_CGY_JHB_ID } from '@shared/lib/mocks/precincts'
import { CGY_ORG_ID } from '@shared/lib/mocks/principals'
import { RouteFields, type RouteEnd } from './RouteFields'

const CLIENT_PRECINCTS = mockPrecincts.filter(p => p.principal_organization_id === CGY_ORG_ID)
const FIXED_ORIGIN: RouteEnd = { kind: 'fixed', name: 'Courier Guy CT, Montague Gardens', hubCode: 'CPT' }
const UNLINKED_DESTINATION: RouteEnd = { kind: 'pick', value: '', options: CLIENT_PRECINCTS, hubCode: 'DUR' }

describe('RouteFields', () => {
  it('shows a manifest-decided end as read-only text with its hub', () => {
    render(<RouteFields origin={FIXED_ORIGIN} destination={UNLINKED_DESTINATION} onPick={vi.fn()} errors={{}} />)

    expect(screen.getByText('Courier Guy CT, Montague Gardens')).toBeInTheDocument()
    expect(screen.getByText(/From manifest · hub/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Origin precinct' })).not.toBeInTheDocument()
  })

  it("lets the dispatcher pick the client's precinct for an unlinked hub", () => {
    const onPick = vi.fn()
    render(<RouteFields origin={FIXED_ORIGIN} destination={UNLINKED_DESTINATION} onPick={onPick} errors={{}} />)

    expect(screen.getByText(/isn't linked/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Destination precinct' }))
    expect(screen.queryByRole('button', { name: /FedEx/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Courier Guy JHB/ }))

    expect(onPick).toHaveBeenCalledWith('destination', PRECINCT_CGY_JHB_ID)
  })

  it('shows an error under the end it belongs to', () => {
    render(
      <RouteFields
        origin={FIXED_ORIGIN}
        destination={UNLINKED_DESTINATION}
        onPick={vi.fn()}
        errors={{ destination: 'Choose the precinct for hub DUR.' }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Choose the precinct for hub DUR.')
    const picker = screen.getByRole('button', { name: 'Destination precinct' })
    expect(picker).toHaveAttribute('data-invalid', 'true')
    expect(picker).toHaveAccessibleDescription('Choose the precinct for hub DUR.')
  })

  it('marks a filled picker invalid too, for "must be different precincts"', () => {
    render(
      <RouteFields
        origin={FIXED_ORIGIN}
        destination={{ ...UNLINKED_DESTINATION, value: PRECINCT_CGY_JHB_ID }}
        onPick={vi.fn()}
        errors={{ destination: 'Origin and destination must be different precincts.' }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Destination precinct' }).className).toContain('border-err')
  })
})
