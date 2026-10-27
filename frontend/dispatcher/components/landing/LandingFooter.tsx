import Link from 'next/link'
import { ROUTES } from '@/lib/constants/routes'
import { COMPANY, CONTACT_EMAIL, SECTIONS } from '@/lib/landing/content'
import { Logo } from './Logo'

const linkClass = 'inline-flex min-h-[44px] items-center text-[0.875rem] text-on-surf-v transition-colors hover:text-on-surf md:min-h-0'

export function LandingFooter() {
  const year = new Date().getFullYear()
  const home = (hash: string) => `${ROUTES.landing}#${hash}`

  return (
    <footer className="border-t border-outline-v/40 bg-surf-low">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-8">
        <div>
          <Logo size={28} />
          <p className="mt-4 max-w-[34ch] text-[0.875rem] leading-relaxed text-on-surf-v">
            Evidence for every handover on South African roads.
          </p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="mt-2 inline-flex min-h-[44px] items-center text-[0.875rem] font-semibold text-sec underline-offset-[3px] hover:underline">
            {CONTACT_EMAIL}
          </a>
        </div>

        <nav aria-label="Product">
          <h2 className="text-[0.8125rem] font-semibold text-on-surf">Product</h2>
          <ul className="mt-2 md:mt-4 md:space-y-3">
            <li><a className={linkClass} href={home(SECTIONS.journey)}>How it works</a></li>
            <li><a className={linkClass} href={home(SECTIONS.why)}>Why it matters</a></li>
            <li><a className={linkClass} href={home(SECTIONS.access)}>Request access</a></li>
            <li><Link className={linkClass} href={ROUTES.login}>Sign in</Link></li>
          </ul>
        </nav>

        <nav aria-label="Company">
          <h2 className="text-[0.8125rem] font-semibold text-on-surf">Company</h2>
          <ul className="mt-2 md:mt-4 md:space-y-3">
            <li><a className={linkClass} href={home(SECTIONS.about)}>About us</a></li>
            <li><Link className={linkClass} href={ROUTES.legalCompany}>Company information</Link></li>
            <li><a className={linkClass} href={`mailto:${CONTACT_EMAIL}`}>Contact</a></li>
          </ul>
        </nav>

        <nav aria-label="Legal">
          <h2 className="text-[0.8125rem] font-semibold text-on-surf">Legal</h2>
          <ul className="mt-2 md:mt-4 md:space-y-3">
            <li><Link className={linkClass} href={ROUTES.legalPrivacy}>Privacy Notice</Link></li>
            <li><Link className={linkClass} href={ROUTES.legalTerms}>Terms of Use</Link></li>
            <li><Link className={linkClass} href={ROUTES.legalCookies}>Cookie Notice</Link></li>
            <li><Link className={linkClass} href={ROUTES.legalCompany}>PAIA &amp; ECT Act</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-outline-v/40">
        <p className="mx-auto max-w-[1240px] px-4 py-6 text-[0.8125rem] text-on-surf-v md:px-8">
          © {year} {COMPANY.legalName}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
