import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ChartCard } from './ChartCard'
import { EventSwitch } from './controls/EventSwitch'

type Props = ComponentProps<typeof ChartCard>

const QUESTION = 'Are we getting busier?'
const BASIS = 'Closed trips, by the day they first departed · 16 trips'
const INFO_BUTTON = 'About this chart: Trips over time'

function renderCard(overrides: Partial<Props> = {}) {
  const props: Props = {
    title: 'Trips over time',
    question: QUESTION,
    basis: BASIS,
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    isEmpty: false,
    emptyBody: 'No closed trips departed in this period.',
    table: <table><tbody><tr><td>41 trips</td></tr></tbody></table>,
    children: <p>the chart</p>,
    ...overrides,
  }
  return render(
    <div>
      <p>somewhere else on the page</p>
      <ChartCard {...props} />
    </div>,
  )
}

function body(): HTMLElement {
  const element = screen.getByRole('heading', { name: 'Trips over time' }).closest('section')?.lastElementChild
  if (!(element instanceof HTMLElement)) throw new Error('no chart body')
  return element
}

function openInfo(): HTMLElement {
  const button = screen.getByRole('button', { name: INFO_BUTTON })
  fireEvent.click(button)
  return button
}

describe('ChartCard', () => {
  it('shows the title and chart when ready', () => {
    renderCard()

    expect(screen.getByRole('heading', { name: 'Trips over time' })).toBeInTheDocument()
    expect(screen.getByText('the chart')).toBeInTheDocument()
    expect(body()).toHaveAttribute('aria-busy', 'false')
  })

  it('swaps the chart for its table and back', () => {
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Show table' }))
    expect(screen.getByText('41 trips')).toBeInTheDocument()
    expect(screen.queryByText('the chart')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show chart' }))
    expect(screen.getByText('the chart')).toBeInTheDocument()
  })

  it('shows a placeholder, not the chart, on first load', () => {
    renderCard({ isLoading: true })

    expect(screen.queryByText('the chart')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show table' })).toBeNull()
    expect(body()).toHaveAttribute('aria-busy', 'true')
  })

  it('keeps the previous chart, dimmed and busy, while a new period loads', () => {
    renderCard({ isRefreshing: true })

    expect(screen.getByText('the chart')).toBeInTheDocument()
    expect(body()).toHaveAttribute('aria-busy', 'true')
    expect(body()).toHaveClass('opacity-50')
  })

  it('explains an error and retries only on request', () => {
    const onRetry = vi.fn()
    renderCard({ error: 'Server unavailable', onRetry })

    expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable')
    expect(screen.queryByText('the chart')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('says there is not enough data yet when nothing was observed', () => {
    renderCard({ isEmpty: true })

    expect(screen.getByText('Not enough data yet')).toBeInTheDocument()
    expect(screen.getByText('No closed trips departed in this period.')).toBeInTheDocument()
  })

  it('zooms the chart and its legend into a dialog, and closes it again (D27)', () => {
    renderCard({ legend: <p>the legend</p>, sampleSize: 3 })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in: Trips over time' }))

    const dialog = screen.getByRole('dialog', { name: 'Trips over time' })
    expect(within(dialog).getByText('the chart')).toBeInTheDocument()
    expect(within(dialog).getByText('the legend')).toBeInTheDocument()
    expect(within(dialog).getByText('Based on only 3 trips — read with care')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close modal' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('the chart')).toBeInTheDocument()
  })

  it('zooms the table when the card is showing its table', () => {
    renderCard({ legend: <p>the legend</p> })
    fireEvent.click(screen.getByRole('button', { name: 'Show table' }))

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in: Trips over time' }))

    const dialog = screen.getByRole('dialog', { name: 'Trips over time' })
    expect(within(dialog).getByText('41 trips')).toBeInTheDocument()
    expect(within(dialog).queryByText('the chart')).toBeNull()
    expect(within(dialog).queryByText('the legend')).toBeNull()
  })

  it.each([
    ['loading', { isLoading: true }],
    ['empty', { isEmpty: true }],
    ['failed', { error: 'Server unavailable' }],
  ] as const)('offers no zoom while %s', (_state, overrides) => {
    renderCard(overrides)

    expect(screen.queryByRole('button', { name: /^Zoom in/ })).toBeNull()
  })

  it('does not warn once there are enough trips', () => {
    renderCard({ sampleSize: 5 })

    expect(screen.queryByText(/read with care/)).toBeNull()
  })
})

describe('ChartCard info popover (spec §7.7)', () => {
  it('keeps the question and basis off the card face until asked', () => {
    renderCard()

    expect(screen.queryByText(QUESTION)).toBeNull()
    expect(screen.queryByText(BASIS)).toBeNull()
    expect(screen.getByRole('button', { name: INFO_BUTTON })).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows the question and basis when the info button is clicked', () => {
    renderCard()

    const button = openInfo()

    expect(button).toHaveAttribute('aria-expanded', 'true')
    const popover = screen.getByRole('region', { name: INFO_BUTTON })
    expect(button).toHaveAttribute('aria-controls', popover.id)
    expect(popover).toHaveTextContent(QUESTION)
    expect(popover).toHaveTextContent(BASIS)
  })

  it('closes on a second click', () => {
    renderCard()
    const button = openInfo()

    fireEvent.click(button)

    expect(screen.queryByText(QUESTION)).toBeNull()
  })

  it('closes on Escape and gives focus back to the button', () => {
    renderCard()
    const button = openInfo()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByText(QUESTION)).toBeNull()
    expect(button).toHaveFocus()
  })

  it('closes on a click outside it', () => {
    renderCard()
    openInfo()

    fireEvent.mouseDown(screen.getByText('somewhere else on the page'))

    expect(screen.queryByText(QUESTION)).toBeNull()
  })

  it('stays open when the click is inside it', () => {
    renderCard()
    openInfo()

    fireEvent.mouseDown(screen.getByText(QUESTION))

    expect(screen.getByText(QUESTION)).toBeInTheDocument()
  })

  it('keeps a caption (how to read the chart) in the popover, under the basis', () => {
    renderCard({ note: 'Top-right = busy and risky.' })
    expect(screen.queryByText('Top-right = busy and risky.')).toBeNull()

    openInfo()

    expect(screen.getByRole('region', { name: INFO_BUTTON })).toHaveTextContent('Top-right = busy and risky.')
  })

  it('shows chart controls in every state, even with nothing to draw', () => {
    renderCard({ isEmpty: true, controls: <button type="button">Arrivals</button> })

    expect(screen.getByRole('button', { name: 'Arrivals' })).toBeInTheDocument()
  })

  it('explains faded buckets behind the info button, never on the card face', () => {
    renderCard({ timeAxis: true })
    expect(screen.queryByText(/^Faded:/)).toBeNull()

    openInfo()

    expect(screen.getByRole('region', { name: INFO_BUTTON })).toHaveTextContent(/Faded: a part week, month or year/)
  })

  it('has no faded-bucket line on a card without a time axis', () => {
    renderCard()

    openInfo()

    expect(screen.getByRole('region', { name: INFO_BUTTON })).not.toHaveTextContent(/Faded/)
  })

  it('puts a card control on the title row with no caption, named for screen readers', () => {
    renderCard({ controls: <EventSwitch value="departures" onChange={vi.fn()} /> })

    expect(screen.queryByText('Show')).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Show departures or arrivals' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show table' })).toBeInTheDocument()
  })

  it('shows a reading caveat on the card face, without opening it', () => {
    renderCard({ caveat: 'Needs a full year of history to compare months fairly.' })

    expect(screen.getByText('Needs a full year of history to compare months fairly.')).toBeInTheDocument()
    expect(screen.queryByText(QUESTION)).toBeNull()
  })

  it('shows the low-sample warning on the card face, without opening it', () => {
    renderCard({ sampleSize: 3 })

    expect(screen.getByText('Based on only 3 trips — read with care')).toBeInTheDocument()
    expect(screen.queryByText(QUESTION)).toBeNull()
    expect(screen.getByText('the chart')).toBeInTheDocument()
  })
})
