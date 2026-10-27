import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COOKIE_NOTICE_KEY, CookieNotice } from '../CookieNotice'

async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
  })
}

function notice(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[aria-label="Cookie notice"]')
  if (!el) throw new Error('Cookie notice not rendered')
  return el
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CookieNotice', () => {
  it('first_visit_shows_the_notice_with_a_link_to_the_full_notice', async () => {
    render(<CookieNotice />)
    await flushFrame()

    expect(notice()).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByRole('link', { name: 'Cookie notice' })).toHaveAttribute('href', '/legal/cookies')
  })

  it('dismiss_hides_the_notice_and_remembers_it', async () => {
    const user = userEvent.setup()
    render(<CookieNotice />)
    await flushFrame()

    await user.click(screen.getByRole('button', { name: 'Got it' }))

    expect(notice()).toHaveAttribute('aria-hidden', 'true')
    expect(window.localStorage.getItem(COOKIE_NOTICE_KEY)).toBe('1')
  })

  it('returning_visitor_never_sees_it', async () => {
    window.localStorage.setItem(COOKIE_NOTICE_KEY, '1')

    render(<CookieNotice />)
    await flushFrame()

    expect(notice()).toHaveAttribute('aria-hidden', 'true')
  })

  it('blocked_storage_still_shows_the_notice_and_dismisses_without_throwing', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })

    render(<CookieNotice />)
    await flushFrame()
    await user.click(screen.getByRole('button', { name: 'Got it' }))

    expect(notice()).toHaveAttribute('aria-hidden', 'true')
  })
})
