'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { visibleSections } from '@/components/settings/sections'
import { useAuth } from '@/lib/hooks/useAuth'
import { ROUTES } from '@/lib/constants/routes'
import { resolveSection, SECTION_PARAM } from '@/lib/settings/section-query'
import { cn } from '@shared/lib/utils/cn'

const HEADING_ID = 'settings-section-heading'

/** The section list beside (or, on a phone, above) the one section it has open. The open
 *  section lives in the URL, so it can be linked to and survives a refresh. */
export function SettingsLayout() {
  const { user } = useAuth()
  const params = useSearchParams()
  const sections = visibleSections(user?.role)
  const active = resolveSection(params.get(SECTION_PARAM), sections)
  const ActiveSection = active.Component

  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-10">
      <nav aria-label="Settings sections" className="md:w-52 md:shrink-0">
        {/* A scrolling row on a phone and a column from md up, so the same links serve both
            and a long list never wraps into a block above the content. */}
        <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {sections.map(section => {
            const isActive = section.id === active.id
            const Icon = section.icon
            return (
              <li key={section.id} className="shrink-0">
                {/* replace: Back leaves Settings instead of stepping through each section. */}
                <Link
                  href={ROUTES.settingsSection(section.id)}
                  replace
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sec',
                    isActive
                      ? 'bg-surf-high font-semibold text-on-surf'
                      : 'font-medium text-on-surf-v hover:bg-surf-low hover:text-on-surf',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="whitespace-nowrap">{section.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <section aria-labelledby={HEADING_ID} className="min-w-0 max-w-2xl flex-1">
        <h2 id={HEADING_ID} className="text-lg font-bold text-on-surf">{active.label}</h2>
        <p className="mt-1 text-sm text-on-surf-v">{active.description}</p>
        <div className="mt-4">
          <ActiveSection />
        </div>
      </section>
    </div>
  )
}
