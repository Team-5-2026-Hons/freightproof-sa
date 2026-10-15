import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const appConstants = vi.hoisted(() => ({ SUPPORT_PHONE: null as string | null }))
vi.mock('@/lib/constants/app', () => appConstants)

import { CallDispatch } from '../CallDispatch'

beforeEach(() => { appConstants.SUPPORT_PHONE = null })

describe('CallDispatch', () => {
  it('test_dials_the_configured_dispatch_number', () => {
    appConstants.SUPPORT_PHONE = '+27 21 555 0100'

    render(<CallDispatch />)

    expect(screen.getByRole('link', { name: 'Call Dispatch' })).toHaveAttribute('href', 'tel:+27215550100')
  })

  it('test_shows_nothing_rather_than_a_number_nobody_answers', () => {
    render(<CallDispatch />)

    expect(screen.queryByRole('link', { name: 'Call Dispatch' })).toBeNull()
  })
})
