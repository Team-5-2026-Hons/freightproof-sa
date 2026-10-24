import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverStaticPageRoutes } from '../static-page-routes'

const created: string[] = []

function makeAppTree(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-tree-'))
  created.push(root)
  for (const file of files) {
    const full = path.join(root, file)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, '')
  }
  return root
}

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('discoverStaticPageRoutes', () => {
  it('maps page.tsx files to routes and strips route groups', () => {
    const root = makeAppTree([
      '(app)/page.tsx',
      '(app)/profile/page.tsx',
      'login/page.tsx',
      'login/phone/page.tsx',
    ])

    expect(discoverStaticPageRoutes(root)).toEqual(['/', '/login', '/login/phone', '/profile'])
  })

  it('skips dynamic segments and the dev-only subtree', () => {
    const root = makeAppTree([
      '(app)/trips/page.tsx',
      '(app)/trips/[id]/page.tsx',
      '(app)/trip/phase/[type]/step/[slug]/page.tsx',
      'dev/tokens/page.tsx',
    ])

    expect(discoverStaticPageRoutes(root)).toEqual(['/trips'])
  })

  it('ignores directories without a page.tsx and non-page files', () => {
    const root = makeAppTree([
      '(app)/trips/past/PastTripsPageClient.tsx',
      '(app)/trips/past/__tests__/PastTripsPage.test.tsx',
      '(app)/trips/page.tsx',
      'layout.tsx',
    ])

    expect(discoverStaticPageRoutes(root)).toEqual(['/trips'])
  })
})

describe('the real app/ tree', () => {
  const routes = discoverStaticPageRoutes(path.resolve(__dirname, '../../../app'))

  it('includes the screens that must open on a cold offline launch', () => {
    expect(routes).toEqual(
      expect.arrayContaining([
        '/evidence',
        '/profile',
        '/trips/past',
        '/trips/upcoming',
        '/trips/detail',
        '/trips/substitution',
      ]),
    )
  })

  it('contains no dynamic or dev routes', () => {
    expect(routes.filter((r) => r.includes('[') || r.startsWith('/dev'))).toEqual([])
  })
})
