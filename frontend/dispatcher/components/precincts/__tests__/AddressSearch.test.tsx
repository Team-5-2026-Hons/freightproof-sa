import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AddressSearch, ADDRESS_SEARCH_DEBOUNCE_MS } from '../AddressSearch'
import type { AddressSuggestion } from '@/lib/geocode/photon'

const mockSearchAddresses = vi.fn()
vi.mock('@/lib/geocode/photon', () => ({
  ADDRESS_QUERY_MIN_LENGTH: 3,
  searchAddresses: (query: string, signal?: AbortSignal) => mockSearchAddresses(query, signal),
}))

const SOOKHAI: AddressSuggestion = {
  id: 'W101', label: 'Sookhai Place', detail: 'Durban, KwaZulu-Natal', latitude: -29.8291, longitude: 30.9544,
}
const CARNARVON: AddressSuggestion = {
  id: 'W102', label: '12 Carnarvon Place', detail: 'Durban', latitude: -29.7735, longitude: 31.0397,
}

function input(): HTMLInputElement {
  return screen.getByRole('combobox', { name: /search address/i })
}

async function typeAndSettle(value: string): Promise<void> {
  fireEvent.change(input(), { target: { value } })
  await act(async () => {
    vi.advanceTimersByTime(ADDRESS_SEARCH_DEBOUNCE_MS)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  mockSearchAddresses.mockReset()
  mockSearchAddresses.mockResolvedValue([SOOKHAI, CARNARVON])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AddressSearch', () => {
  it('test_debounces_typing_into_one_search', async () => {
    render(<AddressSearch onSelect={vi.fn()} />)

    fireEvent.change(input(), { target: { value: 'Sook' } })
    fireEvent.change(input(), { target: { value: 'Sookhai' } })
    await act(async () => {
      vi.advanceTimersByTime(ADDRESS_SEARCH_DEBOUNCE_MS)
    })

    expect(mockSearchAddresses).toHaveBeenCalledTimes(1)
    expect(mockSearchAddresses).toHaveBeenCalledWith('Sookhai', expect.any(AbortSignal))
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('test_does_not_search_under_three_characters', async () => {
    render(<AddressSearch onSelect={vi.fn()} />)

    await typeAndSettle('So')

    expect(mockSearchAddresses).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('test_picking_a_result_reports_it_and_closes_without_searching_again', async () => {
    const onSelect = vi.fn()
    render(<AddressSearch onSelect={onSelect} />)
    await typeAndSettle('Sookhai')

    fireEvent.mouseDown(screen.getByRole('option', { name: /12 Carnarvon Place/ }))
    await act(async () => {
      vi.advanceTimersByTime(ADDRESS_SEARCH_DEBOUNCE_MS)
    })

    expect(onSelect).toHaveBeenCalledWith(CARNARVON)
    expect(input().value).toBe('12 Carnarvon Place, Durban')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(mockSearchAddresses).toHaveBeenCalledTimes(1)
  })

  it('test_arrow_keys_and_enter_pick_from_the_keyboard', async () => {
    const onSelect = vi.fn()
    render(<AddressSearch onSelect={onSelect} />)
    await typeAndSettle('Sookhai')

    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith(CARNARVON)
  })

  it('test_escape_closes_the_results', async () => {
    render(<AddressSearch onSelect={vi.fn()} />)
    await typeAndSettle('Sookhai')

    fireEvent.keyDown(input(), { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('test_says_no_matches_rather_than_showing_nothing', async () => {
    mockSearchAddresses.mockResolvedValue([])
    render(<AddressSearch onSelect={vi.fn()} />)

    await typeAndSettle('Nowhere Road')

    expect(screen.getByText(/no matches in south africa/i)).toBeInTheDocument()
  })

  it('test_says_search_is_unavailable_and_points_at_the_other_inputs_on_failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSearchAddresses.mockRejectedValue(new Error('HTTP 503'))
    render(<AddressSearch onSelect={vi.fn()} />)

    await typeAndSettle('Sookhai')

    expect(screen.getByText(/address search is unavailable/i)).toBeInTheDocument()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
