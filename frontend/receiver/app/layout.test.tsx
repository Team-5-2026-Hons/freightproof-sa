// app/layout.test.tsx
//
// The layout deliberately has no dark theme. If it stops saying so, Android's automatic
// dark mode inverts the page, including the swipe the receiver has to recognise.
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { viewport } from './layout'

describe('root layout viewport', () => {
  it('declares a light colour scheme so automatic dark mode leaves the page alone', () => {
    expect(viewport.colorScheme).toBe('light')
  })
})

describe('next.config', () => {
  it('does not advertise the framework in an X-Powered-By header', () => {
    const nodeRequire = createRequire(import.meta.url)
    const config = nodeRequire('../next.config.js') as { poweredByHeader?: boolean }

    expect(config.poweredByHeader).toBe(false)
  })
})
