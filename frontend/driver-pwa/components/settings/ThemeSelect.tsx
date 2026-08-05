// frontend/driver-pwa/components/settings/ThemeSelect.tsx
'use client'

import { useSyncExternalStore } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCES,
  getThemePref,
  setThemePref,
  subscribeThemePref,
  type ThemePreference,
} from '@/lib/theme'

interface ThemeOption {
  label: string
  Icon: LucideIcon
}

const THEME_OPTIONS: Record<ThemePreference, ThemeOption> = {
  system: { label: 'System', Icon: Monitor },
  light:  { label: 'Light',  Icon: Sun },
  dark:   { label: 'Dark',   Icon: Moon },
}

// Radio group name — one control per screen, but the attribute is what makes the three
// inputs a single arrow-key-navigable group rather than three unrelated radios.
const THEME_RADIO_NAME = 'theme-preference'

// localStorage isn't readable during the static export's server render;
// useSyncExternalStore hydrates against the server snapshot and re-syncs to the stored
// value without a setState-in-effect (same pattern as the tap-to-confirm toggle).
function useThemePref(): ThemePreference {
  return useSyncExternalStore(subscribeThemePref, getThemePref, () => DEFAULT_THEME_PREFERENCE)
}

/**
 * Segmented System / Light / Dark control.
 *
 * Real <input type="radio"> elements behind a styled label, not buttons with
 * aria-checked: it buys correct arrow-key navigation, screen-reader group semantics and
 * "3 of 3" position announcements for free, none of which a div-and-ARIA version gets
 * right by accident.
 */
export function ThemeSelect() {
  const selected = useThemePref()

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="flex gap-1 rounded-xl bg-surface-container p-1">
        {THEME_PREFERENCES.map((pref) => {
          const { label, Icon } = THEME_OPTIONS[pref]
          const isSelected = pref === selected

          return (
            <label key={pref} className="flex-1 cursor-pointer">
              <input
                type="radio"
                name={THEME_RADIO_NAME}
                value={pref}
                checked={isSelected}
                onChange={() => setThemePref(pref)}
                className="peer sr-only"
              />
              {/* The visible segment. peer-focus-visible, because the input itself is
                  sr-only and so has nothing for the global focus ring to draw on. */}
              <span
                className={cn(
                  'flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors',
                  'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                  isSelected
                    ? 'bg-surface-container-lowest text-surface-on shadow-level-1'
                    : 'text-surface-on-variant',
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
                {label}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
