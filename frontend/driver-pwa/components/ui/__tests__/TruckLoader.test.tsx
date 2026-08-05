// frontend/driver-pwa/components/ui/__tests__/TruckLoader.test.tsx
//
// The truck and the road are decorative — everything a screen reader needs has to come
// from the status role and its label, which is the part a redesign could silently drop.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TruckLoader } from '../TruckLoader'

describe('TruckLoader', () => {
  it('exposes a live status region so the wait is announced', () => {
    render(<TruckLoader />)

    expect(screen.getByRole('status')).toHaveAccessibleName('Loading')
  })

  it('announces the caller\'s label when given one', () => {
    render(<TruckLoader label="Loading trip" />)

    expect(screen.getByRole('status')).toHaveAccessibleName('Loading trip')
  })
})
