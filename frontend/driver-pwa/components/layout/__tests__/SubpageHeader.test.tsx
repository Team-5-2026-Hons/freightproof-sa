// frontend/driver-pwa/components/layout/__tests__/SubpageHeader.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SubpageHeader } from '../SubpageHeader'

const mockPush = vi.fn()
const mockBack = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SubpageHeader', () => {
  it('renders the title and a default "← Back" label', () => {
    render(<SubpageHeader title="Log Checkpoint" />)

    expect(screen.getByRole('heading', { name: 'Log Checkpoint' })).toBeInTheDocument()
    expect(screen.getByText('← Back')).toBeInTheDocument()
  })

  it('renders a custom back label', () => {
    render(<SubpageHeader title="Log Exception" backLabel="In-Transit Hub" />)

    expect(screen.getByText('← In-Transit Hub')).toBeInTheDocument()
  })

  it('calls the provided onBack instead of router.back()', () => {
    const onBack = vi.fn()
    render(<SubpageHeader title="Log Exception" backLabel="In-Transit Hub" onBack={onBack} />)

    fireEvent.click(screen.getByText('← In-Transit Hub'))

    expect(onBack).toHaveBeenCalled()
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('falls back to router.back() when no onBack is given', () => {
    render(<SubpageHeader title="Log Exception" />)

    fireEvent.click(screen.getByText('← Back'))

    expect(mockBack).toHaveBeenCalled()
  })

  it('meets the 44px minimum touch target for the back button', () => {
    render(<SubpageHeader title="Log Exception" />)

    expect(screen.getByText('← Back')).toHaveClass('min-h-[44px]')
  })

  it('renders optional right-slot content', () => {
    render(<SubpageHeader title="Log Exception" right={<span>Extra</span>} />)

    expect(screen.getByText('Extra')).toBeInTheDocument()
  })
})
