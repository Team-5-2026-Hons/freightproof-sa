import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import IncidentDetailPage from './page'

const view = vi.fn()
let search = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'inc-1' }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => search,
}))
vi.mock('@/components/incidents/IncidentDetailView', () => ({
  IncidentDetailView: (props: { backHref: string }) => { view(props.backHref); return null },
}))

beforeEach(() => {
  view.mockReset()
})

describe('incident detail page Back target', () => {
  it('returns to the trip it was opened from', () => {
    // Arrange
    search = new URLSearchParams({ returnTo: '/trips/t1?panel=information' })

    // Act
    render(<IncidentDetailPage />)

    // Assert
    expect(view).toHaveBeenCalledWith('/trips/t1?panel=information')
  })

  it('falls back to the incidents list, and never follows an outside URL', () => {
    // Arrange
    search = new URLSearchParams({ returnTo: 'https://evil.example/phish' })

    // Act
    render(<IncidentDetailPage />)

    // Assert
    expect(view).toHaveBeenCalledWith('/incidents')
  })
})
