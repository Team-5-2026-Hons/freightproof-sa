import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { KEEP_EXCEPTION_SELECTION_ATTR } from './useDismissExceptionSelection'
import { TripHelp } from './TripHelp'
import { TRIP_HELP } from './trip-help-copy'

describe('TripHelp', () => {
  it('opens a panel holding the topic’s copy when its button is pressed', async () => {
    render(<TripHelp topic="cargo" />)

    await userEvent.click(screen.getByRole('button', { name: TRIP_HELP.cargo.label }))

    const panel = screen.getByRole('region', { name: TRIP_HELP.cargo.label })
    expect(panel).toHaveTextContent(TRIP_HELP.cargo.question)
    expect(panel).toHaveTextContent(TRIP_HELP.cargo.basis)
    expect(panel).toHaveTextContent(TRIP_HELP.cargo.footnote!)
  })

  it('closes on Escape', async () => {
    render(<TripHelp topic="info" />)
    await userEvent.click(screen.getByRole('button', { name: TRIP_HELP.info.label }))

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('keeps an exception selected when it is pressed', () => {
    render(<TripHelp topic="timeline" />)

    const button = screen.getByRole('button', { name: TRIP_HELP.timeline.label })

    expect(button.closest(`[${KEEP_EXCEPTION_SELECTION_ATTR}]`)).not.toBeNull()
  })

  it('anchors the panel to the right edge, above the sticky toolbar, and lets it scroll on a short screen', async () => {
    render(<TripHelp topic="exceptions" />)
    await userEvent.click(screen.getByRole('button', { name: TRIP_HELP.exceptions.label }))

    const anchor = screen.getByRole('region').closest(`[${KEEP_EXCEPTION_SELECTION_ATTR}]`)!

    expect(anchor.className).toContain('[&_[role=region]]:right-0')
    expect(anchor.className).toContain('[&_[role=region]]:z-30')
    expect(anchor.className).toContain('[&_[role=region]]:overflow-y-auto')
    expect(anchor.className).toContain('[&_[role=region]]:max-w-[min(280px,calc(100vw-4rem))]')
  })

  it('lets the caller place the icon and replace the default height cap', async () => {
    render(<TripHelp topic="timeline" className="absolute right-0 top-0" maxHeight="[&_[role=region]]:max-h-[200px]" />)
    await userEvent.click(screen.getByRole('button', { name: TRIP_HELP.timeline.label }))

    const anchor = screen.getByRole('region').closest(`[${KEEP_EXCEPTION_SELECTION_ATTR}]`)!

    expect(anchor.className).toContain('absolute right-0 top-0')
    expect(anchor.className).toContain('[&_[role=region]]:max-h-[200px]')
    expect(anchor.className).not.toContain('max-h-[70vh]')
  })
})
