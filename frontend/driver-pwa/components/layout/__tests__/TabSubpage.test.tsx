// frontend/driver-pwa/components/layout/__tests__/TabSubpage.test.tsx
//
// The floating action (Continue Driving, Start Trip) is fixed above the tab bar. jsdom cannot
// lay anything out, so what is pinned here is the geometry the classes encode.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TabSubpage } from '../TabSubpage'

vi.mock('../BottomNav', () => ({ BottomNav: () => <nav aria-label="Main navigation" /> }))
vi.mock('../SubpageHeader', () => ({ SubpageHeader: () => <header /> }))

describe('TabSubpage floating action', () => {
  it('test_positions_the_action_against_the_tab_bars_max_floor_not_a_bare_inset', () => {
    render(
      <TabSubpage title="Trip" backLabel="Trips" onBack={() => {}} action={<button type="button">Continue Driving</button>}>
        <p>content</p>
      </TabSubpage>,
    )

    const wrapper = screen.getByRole('button', { name: 'Continue Driving' }).parentElement?.parentElement
    expect(wrapper?.className).toContain('max(env(safe-area-inset-bottom),16px)')
    expect(wrapper?.className).not.toContain('80px+env')
  })

  it('test_reserves_scroll_room_for_the_action_as_well_as_the_bar', () => {
    const { container: withAction } = render(
      <TabSubpage title="Trip" backLabel="Trips" onBack={() => {}} action={<button type="button">Go</button>}>
        <p>content</p>
      </TabSubpage>,
    )
    const { container: without } = render(
      <TabSubpage title="Trip" backLabel="Trips" onBack={() => {}}>
        <p>content</p>
      </TabSubpage>,
    )

    expect(withAction.querySelector('main')?.className).toContain('max(env(safe-area-inset-bottom),16px)')
    expect(without.querySelector('main')?.className).not.toContain('max(env(safe-area-inset-bottom),16px)')
  })
})
