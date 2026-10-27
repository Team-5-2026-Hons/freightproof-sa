// frontend/driver-pwa/components/layout/__tests__/SubpageHeader.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SubpageHeader } from '../SubpageHeader'
import { getEdgeBackHandler } from '@/lib/navigation/edge-back'

const mockPush = vi.fn()
const mockBack = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SubpageHeader', () => {
  it('renders the title and a default "Back" button', () => {
    render(<SubpageHeader title="Log Checkpoint" />)

    expect(screen.getByRole('heading', { name: 'Log Checkpoint' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('names the back button after its destination when a custom label is given', () => {
    render(<SubpageHeader title="Log Exception" backLabel="In Transit" />)

    expect(screen.getByRole('button', { name: 'Back to In Transit' })).toBeInTheDocument()
  })

  it('calls the provided onBack instead of router.back()', () => {
    const onBack = vi.fn()
    render(<SubpageHeader title="Log Exception" backLabel="In Transit" onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to In Transit' }))

    expect(onBack).toHaveBeenCalled()
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('falls back to router.back() when no onBack is given', () => {
    render(<SubpageHeader title="Log Exception" />)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(mockBack).toHaveBeenCalled()
  })

  it('meets the 44px minimum touch target for the back button', () => {
    render(<SubpageHeader title="Log Exception" />)

    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('min-h-[44px]')
  })

  it('renders optional right-slot content', () => {
    render(<SubpageHeader title="Log Exception" right={<span>Extra</span>} />)

    expect(screen.getByText('Extra')).toBeInTheDocument()
  })

  it('renders a "reference" title as a monospace heading with a screen-reader caption', () => {
    render(
      <SubpageHeader
        title="FP-20260804-31F49BDE"
        titleVariant="reference"
        titleCaption="Trip reference"
      />,
    )

    const heading = screen.getByRole('heading', { name: 'FP-20260804-31F49BDE' })
    const caption = screen.getByText('Trip reference')

    expect(heading).toHaveClass('font-mono', 'tabular-nums')
    expect(caption).toHaveClass('sr-only')
  })

  it('centres the title in the bar with the subtitle beneath it', () => {
    render(<SubpageHeader title="In Transit" subtitle="TRP-2026-0041" />)

    const heading = screen.getByRole('heading', { level: 1, name: 'In Transit' })
    expect(heading.parentElement).toHaveClass('text-center')
    expect(screen.getByText('TRP-2026-0041')).toHaveClass('tabular-nums')
    expect(screen.getByText('TRP-2026-0041')).not.toHaveClass('font-mono')
  })

  it('registers its back action for the left-edge swipe while mounted', () => {
    const onBack = vi.fn()
    const { unmount } = render(<SubpageHeader title="Log Exception" onBack={onBack} />)

    getEdgeBackHandler()?.()

    expect(onBack).toHaveBeenCalledTimes(1)
    unmount()
    expect(getEdgeBackHandler()).toBeNull()
  })

  it('renders the back button as an ink chevron in a light round well, with no visible text', () => {
    render(<SubpageHeader title="Log Exception" backLabel="In Transit" />)

    const back = screen.getByRole('button', { name: 'Back to In Transit' })

    expect(back).toHaveClass('rounded-full', 'bg-surface-container-high', 'text-surface-on')
    expect(back).not.toHaveClass('text-secondary')
    expect(back).not.toHaveClass('bg-primary')
    expect(back.textContent).toBe('')
  })

  it('omits the caption when none is given', () => {
    render(<SubpageHeader title="FP-20260804-31F49BDE" titleVariant="reference" />)

    expect(screen.getByRole('heading', { name: 'FP-20260804-31F49BDE' })).toBeInTheDocument()
    expect(screen.queryByText('Trip reference')).not.toBeInTheDocument()
  })
})

describe('SubpageHeader bar variant (overhaul 6.2/6.3)', () => {
  it('test_centres_the_title_in_the_bar_without_a_subtitle', () => {
    render(<SubpageHeader title="Checkpoint" titleVariant="bar" backLabel="In Transit" onBack={() => {}} />)

    const heading = screen.getByRole('heading', { level: 1, name: 'Checkpoint' })
    expect(heading).toHaveClass('text-headline')
    expect(heading.parentElement).toHaveClass('text-center')
  })
})
