// frontend/driver-pwa/app/(app)/__tests__/HomePage.test.tsx
//
// Home's page is the one that can notice the trap described in
// lib/navigation/document-url-mismatch.ts: Capacitor answers any URL it cannot resolve
// with index.html, so after iOS reloads a reclaimed WebView the driver stands on Home's
// page under their step's URL — no tab bar, and the cold-start resume gated out. Tim, 21
// Oct: the only escape was force-quitting the app, twice.
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomePage from '../page'

// The real Home needs the whole provider tree; this suite is only about the recovery.
vi.mock('@/components/home/HomeContent', () => ({
  HomeContent: () => <div data-testid="home-content">Home</div>,
}))

const replace = vi.fn()
const originalLocation = window.location

function standOn(pathname: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, pathname, replace },
  })
}

beforeEach(() => {
  replace.mockClear()
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

describe('HomePage recovery from a mis-served document', () => {
  it('test_home_at_its_own_url_just_renders_home', () => {
    standOn('/')

    render(<HomePage />)

    expect(screen.getByTestId('home-content')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('test_homes_document_under_the_linehaul_step_url_reloads_home', () => {
    standOn('/trip/phase/loading/step/1-linehaul')

    render(<HomePage />)

    // A hard load, not router.replace(): the router believes it is already on this
    // pathname, and the tree it holds is Home's whatever it is asked for.
    expect(replace).toHaveBeenCalledWith('/')
  })

  it('test_a_driver_mid_trip_is_never_told_they_have_no_trip_while_it_recovers', () => {
    standOn('/trip/phase/loading/step/1-linehaul')

    render(<HomePage />)

    // "No trip assigned" is what the stranded screen showed, and it is a lie.
    expect(screen.queryByTestId('home-content')).toBeNull()
    expect(screen.getByRole('status', { name: 'Restoring your trip' })).toBeInTheDocument()
  })
})
