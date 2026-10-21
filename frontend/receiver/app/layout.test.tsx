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

interface NextConfigModule {
  (phase: string): { poweredByHeader?: boolean }
  assertApiUrl: (phase: string, env: Record<string, string | undefined>) => void
}

const loadConfig = (): NextConfigModule => createRequire(import.meta.url)('../next.config.js') as NextConfigModule

describe('next.config', () => {
  it('does not advertise the framework in an X-Powered-By header', () => {
    const config = loadConfig()('phase-development-server')

    expect(config.poweredByHeader).toBe(false)
  })

  it('fails a production build that has no API URL', () => {
    const { assertApiUrl } = loadConfig()

    expect(() => assertApiUrl('phase-production-build', {})).toThrow(/NEXT_PUBLIC_API_URL/)
    expect(() => assertApiUrl('phase-production-build', { NEXT_PUBLIC_API_URL: 'https://api.example.test' })).not.toThrow()
    expect(() => assertApiUrl('phase-development-server', {})).not.toThrow()
  })
})
