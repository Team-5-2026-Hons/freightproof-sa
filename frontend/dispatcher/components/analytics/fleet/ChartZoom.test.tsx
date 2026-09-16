import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChartZoom, useChartHeight, useIsChartZoomed, zoomChartHeight } from './ChartZoom'

const NORMAL_HEIGHT = 240

/** Stands in for a chart: prints the height it would draw at and whether it is zoomed. */
function HeightProbe({ normal = NORMAL_HEIGHT }: { normal?: number }) {
  const height = useChartHeight(normal)
  const zoomed = useIsChartZoomed()
  return <p>{`${height} ${zoomed ? 'zoomed' : 'on card'}`}</p>
}

function openZoom(title = 'Trips over time'): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: `Zoom in: ${title}` }))
  return screen.getByRole('dialog', { name: title })
}

describe('zoomChartHeight', () => {
  it('fills most of a normal window, less the modal title bar and legend', () => {
    expect(zoomChartHeight(1000)).toBe(610)
  })

  it('never goes below the floor on a very short window', () => {
    expect(zoomChartHeight(300)).toBe(320)
  })
})

describe('ChartZoom (D27)', () => {
  it('leaves a chart at its normal height outside the zoom', () => {
    render(<HeightProbe />)

    expect(screen.getByText(`${NORMAL_HEIGHT} on card`)).toBeInTheDocument()
  })

  it('shows nothing extra until the zoom button is pressed', () => {
    render(<ChartZoom title="Trips over time"><HeightProbe /></ChartZoom>)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/zoomed/)).toBeNull()
  })

  it('opens the chart in a dialog, taller, and closes it on the ×', () => {
    render(<ChartZoom title="Trips over time"><HeightProbe /></ChartZoom>)

    const dialog = openZoom()

    expect(within(dialog).getByText(`${zoomChartHeight(window.innerHeight)} zoomed`)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close modal' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('never shrinks a chart that is already taller than the zoomed height', () => {
    const tall = zoomChartHeight(window.innerHeight) + 100
    render(<ChartZoom title="Busiest sites"><HeightProbe normal={tall} /></ChartZoom>)

    const dialog = openZoom('Busiest sites')

    expect(within(dialog).getByText(`${tall} zoomed`)).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    render(<ChartZoom title="Trips over time"><HeightProbe /></ChartZoom>)
    const dialog = openZoom()

    fireEvent(dialog, new Event('cancel', { cancelable: true }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
