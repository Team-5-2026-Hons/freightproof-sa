import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// Mutable through a getter so each test can configure the support line, the way
// NEXT_PUBLIC_SUPPORT_PHONE would be set (or not) in .env.local. Ported from the retired
// Settings page tests (audit M6) when Settings merged into Profile.
let mockSupportPhone: string | null = null
vi.mock('@/lib/constants/app', () => ({
  APP_VERSION: '0.1.0',
  get SUPPORT_PHONE() { return mockSupportPhone },
  SUPPORT_EMAIL: 'support@freightproof.co.za',
}))

import ProfilePage from '../page'
import { ROUTES } from '@/lib/constants/routes'
import { getDriverPhoto, setDriverPhoto } from '@/lib/profile/driver-photo'

// Module-level mocks read through closures at render time (same pattern as the panic tests).
const mockSignOut = vi.fn()
const mockRouterReplace = vi.fn()
const mockPick = vi.fn()
const mockNotify = vi.fn()
let mockTrip: { trip_reference: string; horse: { registration: string } | null } | null = null
let mockQueueLength = 0
const mockPermission: Record<string, string | null> = { location: 'granted', camera: 'granted' }

const user = {
  id: 'drv-1',
  full_name: 'Sipho Dlamini',
  phone_number: '+27825550001',
  license_number: 'DL-998877',
  license_expiry: '2027-03-12' as string | null,
  idvs_status: 'verified' as 'verified' | 'pending' | 'failed',
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: vi.fn() }),
  usePathname: () => '/profile',
}))
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user, signOut: mockSignOut }) }))
vi.mock('@/lib/hooks/useTrip', () => ({ useTrip: () => ({ trip: mockTrip }) }))
vi.mock('@/lib/hooks/useOfflineQueue', () => ({ useOfflineQueue: () => ({ queueLength: mockQueueLength }) }))
vi.mock('@/lib/hooks/usePermissionStatus', () => ({ usePermissionStatus: (k: string) => mockPermission[k] }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: mockNotify }) }))
vi.mock('@/lib/profile/pick-driver-photo', () => ({ pickDriverPhoto: () => mockPick() }))

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mockSignOut.mockResolvedValue(undefined)
  mockTrip = { trip_reference: 'TRP-2026-0041', horse: { registration: 'GP 12-34 ZX' } }
  mockQueueLength = 0
  mockSupportPhone = null
  mockPermission.location = 'granted'
  mockPermission.camera = 'granted'
  user.license_expiry = '2027-03-12'
  user.idvs_status = 'verified'
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Profile — who the driver is', () => {
  it('test_shows_name_phone_and_verified_identity', () => {
    render(<ProfilePage />)

    expect(screen.getByText('Sipho Dlamini')).toBeInTheDocument()
    expect(screen.getByText('+27 82 555 0001')).toBeInTheDocument()
    expect(screen.getByText('ID verified')).toBeInTheDocument()
  })

  it('test_flags_a_pending_identity_check_in_amber_not_green', () => {
    user.idvs_status = 'pending'

    render(<ProfilePage />)

    expect(screen.getByText('ID check pending')).toBeInTheDocument()
    expect(screen.queryByText('ID verified')).toBeNull()
  })

  it('test_shows_licence_number_and_expiry', () => {
    render(<ProfilePage />)

    const tile = screen.getByText('Licence').closest('div') as HTMLElement

    expect(within(tile).getByText('DL-998877')).toBeInTheDocument()
    expect(within(tile).getByText('Expires 12 Mar 2027')).toBeInTheDocument()
  })

  it('test_says_when_no_licence_expiry_is_on_file', () => {
    user.license_expiry = null

    render(<ProfilePage />)

    expect(screen.getByText('No expiry on file')).toBeInTheDocument()
  })

  it('test_vehicle_comes_from_the_active_trip', () => {
    render(<ProfilePage />)

    expect(screen.getByText('GP 12-34 ZX')).toBeInTheDocument()
    expect(screen.getByText('On TRP-2026-0041')).toBeInTheDocument()
  })

  it('test_says_no_active_trip_without_one', () => {
    mockTrip = null

    render(<ProfilePage />)

    expect(screen.getByText('No active trip')).toBeInTheDocument()
  })
})

describe('Profile — photo (stored on this phone only)', () => {
  it('test_adding_a_photo_stores_it_and_shows_it', async () => {
    mockPick.mockResolvedValue('data:image/jpeg;base64,ME')
    render(<ProfilePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Add photo' }))

    await waitFor(() => expect(getDriverPhoto('drv-1')).toBe('data:image/jpeg;base64,ME'))
    expect(screen.getByRole('img', { name: 'Sipho Dlamini' })).toHaveAttribute('src', 'data:image/jpeg;base64,ME')
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument()
  })

  it('test_backing_out_of_the_picker_changes_nothing', async () => {
    mockPick.mockResolvedValue(null)
    render(<ProfilePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Add photo' }))

    await waitFor(() => expect(mockPick).toHaveBeenCalled())
    expect(getDriverPhoto('drv-1')).toBeNull()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('test_a_refused_camera_is_explained', async () => {
    mockPick.mockRejectedValue(new Error('User denied access to camera'))
    render(<ProfilePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Add photo' }))

    await waitFor(() => expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' })))
  })
})

describe('Profile — preferences and phone', () => {
  it('test_appearance_row_opens_the_sheet', () => {
    render(<ProfilePage />)

    fireEvent.click(screen.getByRole('button', { name: /Appearance/ }))

    expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeInTheDocument()
  })

  it('test_tap_instead_of_swipe_is_a_labelled_switch', () => {
    render(<ProfilePage />)

    const toggle = screen.getByRole('switch', { name: /Tap instead of swipe/ })
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('test_permission_rows_say_allowed_or_not_allowed', () => {
    mockPermission.camera = 'denied'

    render(<ProfilePage />)

    expect(screen.getByText('Location').closest('div')).toHaveTextContent('Allowed')
    expect(screen.getByText('Not allowed')).toBeInTheDocument()
  })

  it('test_hides_a_permission_row_the_phone_cannot_report', () => {
    mockPermission.camera = null

    render(<ProfilePage />)

    expect(screen.queryByText('Camera')).toBeNull()
  })

  it('test_waiting_to_send_reports_the_offline_queue', () => {
    mockQueueLength = 3

    render(<ProfilePage />)

    expect(screen.getByText('3 waiting')).toBeInTheDocument()
  })

  it('test_email_support_is_a_mailto_link', () => {
    render(<ProfilePage />)

    expect(screen.getByRole('link', { name: /Email support/ })).toHaveAttribute('href', 'mailto:support@freightproof.co.za')
  })

  it('test_hides_the_call_row_until_a_support_number_is_configured', () => {
    render(<ProfilePage />)

    expect(screen.queryByRole('link', { name: /Call support/ })).toBeNull()
  })

  it('test_call_row_dials_the_configured_number_without_spaces', () => {
    mockSupportPhone = '+27 21 555 0100'

    render(<ProfilePage />)

    expect(screen.getByRole('link', { name: /Call support/ })).toHaveAttribute('href', 'tel:+27215550100')
  })

  it('test_groups_the_settings_under_one_heading_each', () => {
    render(<ProfilePage />)

    for (const title of ['Preferences', 'This phone', 'Help']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
  })
})

describe('Profile — sign out', () => {
  it('test_sign_out_asks_first', () => {
    render(<ProfilePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    expect(screen.getByRole('dialog', { name: 'Sign out?' })).toBeInTheDocument()
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('test_confirming_clears_the_photo_signs_out_and_goes_to_login', async () => {
    setDriverPhoto('drv-1', 'data:image/jpeg;base64,ME')
    render(<ProfilePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Sign out?' })).getByRole('button', { name: 'Sign Out' }))

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.login))
    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(getDriverPhoto('drv-1')).toBeNull()
  })
})
