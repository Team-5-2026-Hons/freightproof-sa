'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { ChevronRight, Mail, Phone } from 'lucide-react'
import { Switch } from '@/components/ui/Switch'
import { ThemeSelect } from '@/components/settings/ThemeSelect'
import { APP_VERSION, SUPPORT_PHONE, SUPPORT_EMAIL } from '@/lib/constants/app'
import {
  getTapToConfirmPref,
  setTapToConfirmPref,
  subscribeTapToConfirmPref,
} from '@/lib/constants/preferences'

// localStorage isn't readable during the static export's server render;
// useSyncExternalStore hydrates against the server snapshot (false) and
// re-syncs to the stored value without a setState-in-effect.
function useTapToConfirm(): boolean {
  return useSyncExternalStore(subscribeTapToConfirmPref, getTapToConfirmPref, () => false)
}

// iOS inset-grouped list: a small header above each group, rows inside one rounded
// surface separated by hairlines, and an explanation as a footer below it (audit M7).
// The old screen was one padded grey card per section with the explanation inside it,
// which read as a stack of notices rather than a list of settings.
function SettingsGroup({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`settings-${title}`} className="flex flex-col gap-1.5">
      <h2 id={`settings-${title}`} className="px-4 text-footnote font-semibold text-surface-on-variant">
        {title}
      </h2>
      <div className="divide-y divide-outline-variant/30 overflow-hidden rounded-2xl bg-surface-container-lowest shadow-level-1">
        {children}
      </div>
      {footer !== undefined && <p className="px-4 text-footnote text-surface-on-variant">{footer}</p>}
    </section>
  )
}

// A tappable contact row (audit M6): the support line and inbox open straight in the
// phone's dialler and mail app instead of being text the driver has to copy by hand.
function ContactRow({ href, icon, label, value }: { href: string; icon: ReactNode; label: string; value: string }) {
  return (
    <a
      href={href}
      className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors duration-100 active:bg-surface-container-low"
    >
      <span className="text-secondary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-body text-surface-on">{label}</span>
        <span className="block truncate text-footnote text-surface-on-variant">{value}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-outline" strokeWidth={2} aria-hidden />
    </a>
  )
}

export default function SettingsPage() {
  const tapToConfirm = useTapToConfirm()

  return (
    // The screen title is AppShell's large title — a page-level h1 here doubled it.
    <main className="flex flex-col gap-6 p-4">
      <SettingsGroup title="Support">
        {/* Hidden until NEXT_PUBLIC_SUPPORT_PHONE is configured — see lib/constants/app.ts. */}
        {SUPPORT_PHONE !== null && (
          <ContactRow
            href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`}
            icon={<Phone className="h-5 w-5" strokeWidth={2} aria-hidden />}
            label="Call Support"
            value={SUPPORT_PHONE}
          />
        )}
        <ContactRow
          href={`mailto:${SUPPORT_EMAIL}`}
          icon={<Mail className="h-5 w-5" strokeWidth={2} aria-hidden />}
          label="Email Support"
          value={SUPPORT_EMAIL}
        />
      </SettingsGroup>

      <SettingsGroup title="Appearance" footer="System follows your phone, including its automatic switch at sunset.">
        <div className="p-2">
          <ThemeSelect />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Accessibility" footer="Applies the next time a confirm control appears.">
        <div className="flex min-h-[52px] items-center justify-between gap-4 pl-4 pr-2">
          <label htmlFor="tap-to-confirm" className="text-body text-surface-on">
            Tap to Confirm Instead of Swipe
          </label>
          <Switch
            id="tap-to-confirm"
            checked={tapToConfirm}
            onCheckedChange={setTapToConfirmPref}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title="About">
        <div className="flex min-h-[52px] items-center justify-between gap-4 px-4">
          <span className="text-body text-surface-on">FreightProof Driver</span>
          <span className="text-body tabular-nums text-surface-on-variant">Version {APP_VERSION}</span>
        </div>
      </SettingsGroup>
    </main>
  )
}
