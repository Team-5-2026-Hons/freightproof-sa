import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import SettingsPage from '../page'
import { ROUTES } from '@/lib/constants/routes'
import { peekTransition, resetTransition } from '@/lib/navigation/transition-direction'

const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace }) }))

describe('/settings', () => {
  it('test_redirects_to_profile_in_place', () => {
    resetTransition()

    const { container } = render(<SettingsPage />)

    expect(mockReplace).toHaveBeenCalledWith(ROUTES.profile)
    expect(peekTransition()).toBe('none')
    expect(container).toBeEmptyDOMElement()
  })
})
