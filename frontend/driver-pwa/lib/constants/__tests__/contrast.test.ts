import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// Contrast is computed from the real token values in app/globals.css, not from a copy of
// them, so a palette edit that drops a text/ground pair below WCAG fails here instead of
// on a phone in the sun. Pairs are the ones the overhaul renders actually put together.

type Rgb = readonly [number, number, number]

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

/** The --fp-* channels declared in the first block that opens with `selector {`. */
function tokens(selector: ':root' | '.dark'): Record<string, Rgb> {
  const escaped = selector.replace('.', '\\.')
  const block = new RegExp(`\\n  ${escaped} \\{([\\s\\S]*?)\\n  \\}`).exec(CSS)
  if (block === null) throw new Error(`no ${selector} block in globals.css`)
  const out: Record<string, Rgb> = {}
  for (const m of block[1].matchAll(/--fp-([a-z-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])]
  }
  return out
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// [foreground, ground, minimum]. 4.5:1 for text; 3:1 for the progress segment, which is
// a non-text indicator (WCAG 1.4.11).
const PAIRS: readonly (readonly [string, string, number])[] = [
  ['surface-on', 'surface', 4.5],
  ['surface-on-variant', 'surface', 4.5],
  ['surface-on', 'fill', 4.5],
  ['surface-on-variant', 'fill', 4.5],
  ['primary-on', 'primary', 4.5],
  ['success', 'surface', 4.5],
  ['success-ink', 'success-tint', 4.5],
  ['success', 'success-tint', 4.5], // met RequirementChips

  ['attention', 'surface', 4.5],
  ['attention', 'attention-tint', 4.5],
  ['attention-ink', 'attention-tint', 4.5],
  ['error', 'surface', 4.5],
  ['error', 'error-tint', 4.5],
  ['error-on', 'error', 4.5], // the panic swipe's label on its red track (7.1)
  ['chain', 'surface', 4.5], // the receipt's "Anchoring…" label on the white toast (5.4)
  ['chain', 'chain-tint', 4.5],
  ['secondary', 'surface', 3],
]

describe.each([':root', '.dark'] as const)('palette contrast in %s', (selector) => {
  const t = tokens(selector)

  it.each(PAIRS)('test_%s_on_%s_meets_%s_to_1', (fg, bg, min) => {
    expect(t[fg], `--fp-${fg} missing`).toBeDefined()
    expect(t[bg], `--fp-${bg} missing`).toBeDefined()

    const value = ratio(t[fg], t[bg])

    expect(value).toBeGreaterThanOrEqual(min)
  })
})

describe('light page ground', () => {
  it('test_light_surface_is_pure_white', () => {
    // Tim, 14 Oct: full white backgrounds. The old ground was a pink-cast #fcf8f9.
    expect(tokens(':root').surface).toEqual([255, 255, 255])
  })
})
