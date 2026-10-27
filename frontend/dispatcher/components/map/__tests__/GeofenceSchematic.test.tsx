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

    expect(screen.getByTestId('schematic-scale-label').textContent).toMatch(/^\d+ m$/)
  })

  it('describes itself for screen readers', () => {
    render(<GeofenceSchematic radiusMetres={350} />)

    expect(screen.getByRole('img', { name: /350 m geofence/i })).toBeInTheDocument()
  })

  it('does not throw and still renders a positive scale for a non-positive radius', () => {
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

      expect(circleRadiusSvg / scaleWidthSvg).toBeCloseTo(radiusMetres / scaleMetres, 5)
    },
  )
})

describe('GeofenceSchematic outline', () => {
  const PIN: [number, number] = [-29.7942, 30.982]
  const BOX: [number, number][] = [[-29.7937, 30.9815], [-29.7937, 30.9825], [-29.7947, 30.9825], [-29.7947, 30.9815]]

  it('test_draws_the_outline_instead_of_the_circle', () => {
    render(<GeofenceSchematic radiusMetres={200} polygon={BOX} centre={PIN} />)

    const outline = screen.getByTestId('schematic-fence-outline')
    expect(outline.getAttribute('points')?.split(' ')).toHaveLength(4)
    expect(screen.queryByTestId('schematic-fence-circle')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /property outline with 4 corners/ })).toBeInTheDocument()
  })

  it('test_falls_back_to_the_circle_without_a_centre', () => {
    render(<GeofenceSchematic radiusMetres={200} polygon={BOX} />)

    expect(screen.getByTestId('schematic-fence-circle')).toBeInTheDocument()
  })
})
