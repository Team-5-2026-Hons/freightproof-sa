'use client'

import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { THEME_PREVIEW_CLASSES } from '@/lib/tokens'
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
}

const THEME_OPTIONS: Record<ThemePreference, ThemeOption> = {
  system: { label: 'System' },
  light:  { label: 'Light' },
  dark:   { label: 'Dark' },
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
 * System / Light / Dark as three preview tiles.
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
      <div className="grid grid-cols-3 gap-2.5">
        {THEME_PREFERENCES.map((pref) => {
          const { label } = THEME_OPTIONS[pref]
          const isSelected = pref === selected

          return (
            <label key={pref} className="cursor-pointer">
              <input
                type="radio"
                name={THEME_RADIO_NAME}
                value={pref}
                checked={isSelected}
                onChange={() => setThemePref(pref)}
                className="peer sr-only"
              />
              {/* The preview. Literal light/dark faces, not tokens: it shows what each
                  choice LOOKS like, so it must not itself change with the current theme.
                  peer-focus-visible because the input is sr-only. */}
              <span
                aria-hidden
                className={cn(
                  'block h-28 rounded-[18px] p-1.5 transition-shadow',
                  'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                  isSelected ? 'ring-[2.5px] ring-surface-on' : 'ring-1 ring-hairline',
                )}
              >
                <span className={cn('block h-full overflow-hidden rounded-xl', THEME_PREVIEW_CLASSES[pref])} />
              </span>
              <span
                className={cn(
                  'mt-2 block text-center text-subhead',
                  isSelected ? 'font-semibold text-surface-on' : 'text-surface-on-variant',
                )}
              >
                {label}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
