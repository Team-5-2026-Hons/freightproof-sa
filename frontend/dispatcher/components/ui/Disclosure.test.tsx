import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Disclosure } from './Disclosure'

const KEY = 'fp.tripInfo.section.route'

function renderRoute(props: Partial<React.ComponentProps<typeof Disclosure>> = {}) {
  return render(<Disclosure id="route" title="Route" summary="3 stops" {...props}><p>Stop list</p></Disclosure>)
}

const details = () => screen.getByRole('group') as HTMLDetailsElement

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('Disclosure', () => {
  it('starts closed unless defaultOpen says otherwise', () => {
    const { unmount } = renderRoute()
    expect(details().open).toBe(false)
    unmount()

    renderRoute({ defaultOpen: true })
    expect(details().open).toBe(true)
  })

  it('toggles_on_click', async () => {
    renderRoute()

    await userEvent.click(screen.getByText('Route'))
    expect(details().open).toBe(true)

    await userEvent.click(screen.getByText('Route'))
    expect(details().open).toBe(false)
  })

  it('toggles_from_the_keyboard', async () => {
    renderRoute()
    const summary = screen.getByText('Route').closest('summary')!

    // Browsers turn Enter and Space on a summary into a click, which user-event does not model.
    summary.focus()
    expect(summary).toHaveFocus()
    fireEvent.click(summary)

    expect(details().open).toBe(true)
  })

  it('shows_the_summary_line_while_closed_and_open', async () => {
    renderRoute()

    expect(details().open).toBe(false)
    expect(screen.getByText('3 stops')).toBeVisible()

    await userEvent.click(screen.getByText('Route'))
    expect(screen.getByText('3 stops')).toBeVisible()
  })

  it('names_its_heading_so_a_wrapper_can_label_itself_by_it', () => {
    renderRoute()

    expect(screen.getByRole('heading', { name: 'Route' })).toHaveAttribute('id', 'disclosure-route-heading')
  })

  it('obeys_a_controlled_open_prop_and_reports_attempts_to_change_it', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = renderRoute({ open: true, onOpenChange })
    expect(details().open).toBe(true)

    await userEvent.click(screen.getByText('Route'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    // Controlled: it stays as told, and nothing is remembered on the caller's behalf.
    expect(details().open).toBe(true)
    expect(localStorage.getItem(KEY)).toBeNull()

    rerender(<Disclosure id="route" title="Route" open={false} onOpenChange={onOpenChange}><p>Stop list</p></Disclosure>)
    expect(details().open).toBe(false)
  })

  it('remembers_the_choice_per_section', async () => {
    const { unmount } = renderRoute()

    await userEvent.click(screen.getByText('Route'))
    expect(localStorage.getItem(KEY)).toBe('1')
    unmount()

    renderRoute()
    expect(details().open).toBe(true)
  })

  it('lets_a_stored_choice_beat_defaultOpen', () => {
    localStorage.setItem(KEY, '0')

    renderRoute({ defaultOpen: true })

    expect(details().open).toBe(false)
  })

  it('follows_defaultOpen_until_the_reader_chooses', () => {
    const { rerender } = renderRoute({ defaultOpen: false })
    expect(details().open).toBe(false)

    rerender(<Disclosure id="route" title="Route" defaultOpen><p>Stop list</p></Disclosure>)

    expect(details().open).toBe(true)
  })

  it('works_when_storage_throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    renderRoute({ defaultOpen: true })
    expect(details().open).toBe(true)

    await userEvent.click(screen.getByText('Route'))

    expect(details().open).toBe(false)
  })

  it('follows_the_browser_opening_it_to_reveal_a_find_in_page_match', () => {
    renderRoute()

    act(() => {
      details().open = true
      details().dispatchEvent(new Event('toggle'))
    })

    expect(details().open).toBe(true)
    expect(localStorage.getItem(KEY)).toBe('1')
  })

  describe('forceOpenKey', () => {
    it('opens_once_for_a_new_key_and_then_lets_the_reader_fold_it_away', async () => {
      renderRoute({ forceOpenKey: 'trip-1' })
      expect(details().open).toBe(true)

      await userEvent.click(screen.getByText('Route'))

      expect(details().open).toBe(false)
    })

    it('does_not_reopen_on_a_re_render_with_the_same_key', async () => {
      const { rerender } = renderRoute({ forceOpenKey: 'trip-1' })
      await userEvent.click(screen.getByText('Route'))

      rerender(<Disclosure id="route" title="Route" forceOpenKey="trip-1"><p>Stop list</p></Disclosure>)

      expect(details().open).toBe(false)
    })

    it('opens_again_for_a_different_key_and_overrides_a_stored_closed', () => {
      localStorage.setItem(KEY, '0')
      const { rerender } = renderRoute({ forceOpenKey: null })
      expect(details().open).toBe(false)

      rerender(<Disclosure id="route" title="Route" forceOpenKey="trip-2"><p>Stop list</p></Disclosure>)

      expect(details().open).toBe(true)
      expect(localStorage.getItem(KEY)).toBe('1')
    })

    it('reports_a_collapse_that_follows_a_forced_open', async () => {
      const onOpenChange = vi.fn()
      renderRoute({ forceOpenKey: 'trip-1', onOpenChange })

      await userEvent.click(screen.getByText('Route'))

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
