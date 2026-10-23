import { describe, expect, it } from 'vitest'

import type { Precinct } from '@shared/lib/types/precinct'

import { NO_ROUTE_NAME, routeShortName } from './route-name'

function precinctNamed(name: string): Precinct {
  return { id: crypto.randomUUID(), name } as Precinct
}

describe('routeShortName', () => {
  it('takes the place from a name joined with a middle dot', () => {
    const precinct = precinctNamed('FedEx JHB · Linbro Park')

    expect(routeShortName([precinct], precinct.id)).toBe('FedEx JHB')
  })

  it('still splits names saved with the older em dash', () => {
    const spaced = precinctNamed('FedEx JHB — Linbro Park')
    const tight = precinctNamed('Courier Guy CT—Montague Gardens')

    expect(routeShortName([spaced, tight], spaced.id)).toBe('FedEx JHB')
    expect(routeShortName([spaced, tight], tight.id)).toBe('Courier Guy CT')
  })

  it('keeps a name with no separator whole', () => {
    const precinct = precinctNamed('Cape Town Depot (Epping)')

    expect(routeShortName([precinct], precinct.id)).toBe('Cape Town Depot (Epping)')
  })

  it('gives a dash for an unknown or missing precinct', () => {
    expect(routeShortName([], crypto.randomUUID())).toBe(NO_ROUTE_NAME)
    expect(routeShortName([], null)).toBe(NO_ROUTE_NAME)
  })
})
