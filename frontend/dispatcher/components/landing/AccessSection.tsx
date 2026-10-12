import Link from 'next/link'
import { ROUTES } from '@/lib/constants/routes'
import { CONTACT_EMAIL, SECTIONS } from '@/lib/landing/content'
import { AccessRequestForm } from './AccessRequestForm'

export function AccessSection() {
  return (
    <section id={SECTIONS.access} aria-labelledby="access-heading" className="scroll-mt-16 border-t border-outline-v/40 bg-surf-low py-24 md:py-32">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 md:grid-cols-[0.85fr_1.15fr] md:gap-20 md:px-8">
        <div>
          <h2 id="access-heading" className="text-balance text-[min(2rem,9vw)] font-extrabold leading-[1.06] tracking-[-0.035em] text-on-surf md:text-[min(3.25rem,4.5vw)]">
            Put your next trip on the record.
          </h2>
          <p className="mt-6 max-w-[44ch] text-[1.0625rem] leading-relaxed text-on-surf-v md:text-[1.1875rem]">
            We set up accounts for each operator. Tell us about your fleet and we’ll be in touch
            to talk about your routes.
          </p>
          <dl className="mt-10 space-y-6 border-t border-outline-v/50 pt-8">
            <div>
              <dt className="text-[0.9375rem] font-semibold text-on-surf">Already set up?</dt>
              <dd className="mt-1 text-[0.9375rem] text-on-surf-v">
                <Link href={ROUTES.login} className="font-semibold text-sec underline-offset-[3px] hover:underline">Sign in to the dispatcher dashboard</Link>
              </dd>
            </div>
            <div>
              <dt className="text-[0.9375rem] font-semibold text-on-surf">Prefer to write to us?</dt>
              <dd className="mt-1 text-[0.9375rem] text-on-surf-v">
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-sec underline-offset-[3px] hover:underline">{CONTACT_EMAIL}</a>
              </dd>
            </div>
          </dl>
        </div>
        <AccessRequestForm />
      </div>
    </section>
  )
}
