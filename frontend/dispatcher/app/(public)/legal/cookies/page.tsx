import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalDoc, LegalTable } from '@/components/landing/LegalDoc'
import { ROUTES } from '@/lib/constants/routes'
import { COMPANY } from '@/lib/landing/content'

export const metadata: Metadata = {
  title: 'Cookie Notice: FreightProof SA',
  description: 'The browser storage FreightProof SA uses, and why there is nothing to opt in to.',
}

const STORAGE_ROWS = [
  ['sb-…-auth-token', 'Keeps you signed in to the dashboard (set by our authentication provider, Supabase).', 'Strictly necessary', 'Until you sign out or the session expires'],
  ['fp:last-activity', 'Signs you out after a period of inactivity, across tabs.', 'Strictly necessary', 'Cleared when you sign out'],
  ['fp:return-to', 'Takes you back to the page you were on after an automatic sign-out.', 'Strictly necessary', 'Cleared at your next sign-in'],
  ['fp:suppress-return-save', 'Stops a deliberate sign-out from being treated as an automatic one (session storage).', 'Strictly necessary', 'Until the tab closes'],
  ['fp.sidebarCollapsed', 'Remembers whether you collapsed the dashboard sidebar.', 'Preference', 'Until you clear it'],
  ['fp.forensicOn', 'Remembers whether you turned on forensic view in the dashboard.', 'Preference', 'Until you clear it'],
  ['fp:cookie-notice-seen', 'Remembers that you’ve seen this notice.', 'Preference', 'Until you clear it'],
] as const

export default function CookiesPage() {
  return (
    <LegalDoc
      title="Cookie Notice"
      current={ROUTES.legalCookies}
      intro={
        <p>
          FreightProof doesn’t use advertising, analytics or tracking cookies. We use a small
          amount of first-party browser storage that the site needs to work, plus a few
          display preferences you set yourself.
        </p>
      }
    >
      <h2>What we store in your browser</h2>
      <p>
        These are stored in your browser’s local or session storage rather than as cookies,
        but the same rules apply, so we list them all. None of them are shared with advertisers
        or used to follow you to other sites.
      </p>
      <LegalTable
        caption="Browser storage used by FreightProof"
        head={['Name', 'What it does', 'Type', 'How long']}
        rows={STORAGE_ROWS.map(row => [<code key="k" className="text-[0.8125rem] font-semibold text-on-surf">{row[0]}</code>, row[1], row[2], row[3]])}
      />

      <h2>Why there’s no “accept or reject” banner</h2>
      <p>
        Strictly necessary storage is required for the service you asked for, such as staying
        signed in, so it can’t be switched off without breaking the site. The preferences only
        record choices you made. Because there’s nothing optional to switch off, we show a
        one-time notice instead of a consent prompt. If we ever add analytics or anything else
        that isn’t essential, we will ask for your consent first.
      </p>

      <h2>Third parties</h2>
      <p>
        Inside the dashboard, map images are loaded from OpenStreetMap and Esri. Those requests
        reveal your IP address to the provider, as any web request does, but we don’t ask them to
        set cookies or track you. The public pages of this website load nothing from third parties.
      </p>

      <h2>Clearing it</h2>
      <p>
        You can clear this storage at any time in your browser’s settings, under site data for
        this website. You’ll be signed out, and the preferences will reset.
      </p>

      <h2>More</h2>
      <p>
        See the <Link href={ROUTES.legalPrivacy}>Privacy Notice</Link> for how we handle personal
        information, or email <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.
      </p>
    </LegalDoc>
  )
}
