import fs from 'node:fs'
import path from 'node:path'

const PAGE_FILE = 'page.tsx'
const EXCLUDED_TOP_LEVEL_DIR = 'dev'

/**
 * Every static route that has a `page.tsx` under `appDir`, sorted. Route groups
 * `(name)` add no URL segment. Dynamic segments `[x]` are skipped: they need
 * `generateStaticParams`, so the caller lists their concrete URLs itself.
 */
export function discoverStaticPageRoutes(appDir: string): string[] {
  const routes: string[] = []

  function walk(dir: string, segments: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === PAGE_FILE) {
        routes.push('/' + segments.join('/'))
        continue
      }
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('[')) continue
      if (segments.length === 0 && entry.name === EXCLUDED_TOP_LEVEL_DIR) continue
      const isRouteGroup = entry.name.startsWith('(') && entry.name.endsWith(')')
      walk(path.join(dir, entry.name), isRouteGroup ? segments : [...segments, entry.name])
    }
  }

  walk(appDir, [])
  return routes.sort()
}
