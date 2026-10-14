import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GeofenceSchematic, niceScaleMetres } from '../GeofenceSchematic'

describe('niceScaleMetres', () => {
  it('rounds down to a readable 1/2/5 step', () => {
    expect(niceScaleMetres(237)).toBe(200)
    expect(niceScaleMetres(96)).toBe(50)
    expect(niceScaleMetres(12)).toBe(10)
    expect(niceScaleMetres(640)).toBe(500)
  })

  it('never returns zero, so the scale bar always has a label', () => {
    expect(niceScaleMetres(3)).toBeGreaterThan(0)
    expect(niceScaleMetres(0.4)).toBeGreaterThan(0)
  })

  it('never rounds a sub-1 input UP past the input — "down" means down', () => {
    // Regression: the old implementation clamped every result to a floor of 1, which
    // rounded 0.4 up to 1 — a scale bar reading "1 m" for a 0.4 m radius is a lie.
    expect(niceScaleMetres(0.4)).toBeLessThanOrEqual(0.4)
  })

  it('is finite and positive for degenerate inputs, so it never leaks NaN/Infinity into an SVG attribute', () => {
    expect(niceScaleMetres(NaN)).toBe(1)
    expect(niceScaleMetres(Infinity)).toBe(1)
    expect(niceScaleMetres(-5)).toBe(1)
  })
})

describe('GeofenceSchematic', () => {
  it('labels the radius it was given', () => {
    render(<GeofenceSchematic radiusMetres={200} />)

    expect(screen.getByText('200 m')).toBeInTheDocument()
  })

  it('renders a scale bar label', () => {
    render(<GeofenceSchematic radiusMetres={200} />)

    // Scale is derived from the radius, so it must exist and end in "m".
    expect(screen.getByTestId('schematic-scale-label').textContent).toMatch(/^\d+ m$/)
  })

  it('describes itself for screen readers', () => {
    render(<GeofenceSchematic radiusMetres={350} />)

    expect(screen.getByRole('img', { name: /350 m geofence/i })).toBeInTheDocument()
  })

  it('does not throw and still renders a positive scale for a non-positive radius', () => {
    // Not reachable via the create/edit form (validation floors radius at 50 m), but
    // this component's whole job is to always render — it must survive garbage input.
    render(<GeofenceSchematic radiusMetres={0} />)

    const scaleMetres = Number(screen.getByTestId('schematic-scale-label').textContent?.replace(' m', ''))
    expect(scaleMetres).toBeGreaterThan(0)
    expect(Number.isFinite(scaleMetres)).toBe(true)
  })

  it.each([50, 200, 350, 5000])(
    'keeps the fence circle and the scale bar in the same metres-to-pixels ratio at %i m',
    (radiusMetres) => {
      const { container } = render(<GeofenceSchematic radiusMetres={radiusMetres} />)

      const circle = container.querySelector('[data-testid="schematic-fence-circle"]')
      const scaleLine = container.querySelector('[data-testid="schematic-scale-line"]')
      const scaleLabel = screen.getByTestId('schematic-scale-label')

      const circleRadiusSvg = Number(circle?.getAttribute('r'))
      const scaleWidthSvg = Number(scaleLine?.getAttribute('x2'))
      const scaleMetres = Number(scaleLabel.textContent?.replace(' m', ''))

      // This is the property the whole component exists for: the circle and the scale
      // bar must agree on metres-per-pixel, or the diagram lies about distance.
      expect(circleRadiusSvg / scaleWidthSvg).toBeCloseTo(radiusMetres / scaleMetres, 5)
    },
  )
})
