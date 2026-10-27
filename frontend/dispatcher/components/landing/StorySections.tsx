import type { ReactNode } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { FACTS, SECTIONS, TEAM } from '@/lib/landing/content'
import { cn } from '@shared/lib/utils/cn'

const container = 'mx-auto max-w-[1240px] px-4 md:px-8'
const sectionHeading = 'text-balance text-[min(2rem,9vw)] font-extrabold leading-[1.06] tracking-[-0.035em] text-on-surf md:text-[min(3.25rem,4.5vw)]'
const lede = 'text-[1.0625rem] leading-relaxed text-on-surf-v md:text-[1.1875rem]'

function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[0.8125rem] font-medium text-on-surf-v underline decoration-outline-v underline-offset-[3px] transition-colors hover:text-sec hover:decoration-sec"
    >
      {children}
    </a>
  )
}

/** The problem, told with the only figures we could verify. */
export function WhySection() {
  const [lead, ...rest] = FACTS
  return (
    <section id={SECTIONS.why} aria-labelledby="why-heading" className="scroll-mt-16 border-t border-outline-v/40 bg-surf-lowest py-24 md:py-36">
      <div className={container}>
        <div className="grid gap-10 md:grid-cols-[1fr_1fr] md:gap-20">
          <h2 id="why-heading" className={sectionHeading}>Every leg is tracked. The handover isn’t.</h2>
          <p className={cn(lede, 'md:pt-3')}>
            GPS knows where the truck is. The manifest knows what’s on it. The gate knows who
            drove in. None of them share what they know at the moment cargo changes hands. That gap
            is where organised theft works, and where a disputed delivery becomes one company’s
            word against another’s.
          </p>
        </div>

        <figure className="mt-20 md:mt-28">
          <blockquote className="max-w-[22ch] text-balance text-[min(2.25rem,9vw)] font-bold leading-[1.08] tracking-[-0.035em] text-on-surf-v md:text-[min(4rem,5.5vw)]">
            <span className="tabular-nums text-on-surf">{lead.figure}</span> {lead.statement}
          </blockquote>
          <figcaption className="mt-4"><SourceLink href={lead.href}>{lead.source}</SourceLink></figcaption>
        </figure>

        <div className="mt-16 grid gap-10 border-t border-outline-v/40 pt-10 md:grid-cols-2 md:gap-20">
          {rest.map(fact => (
            <figure key={fact.figure}>
              <p className="text-[1.1875rem] leading-snug text-on-surf-v md:text-[1.375rem]">
                <span className="font-bold tabular-nums text-on-surf">{fact.figure}</span> {fact.statement}
              </p>
              <figcaption className="mt-3"><SourceLink href={fact.href}>{fact.source}</SourceLink></figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}

const SAMPLE_TIMELINE = [
  { time: '05:48', label: 'Trip locked', detail: 'Driver, vehicle and 412 units committed', state: 'ok' },
  { time: '07:31', label: 'Loaded and sealed', detail: 'Seal 0048213 · signed waybill recorded', state: 'ok' },
  { time: '08:02', label: 'Departed origin', detail: 'Seal intact at the gate', state: 'ok' },
  { time: '16:40', label: 'Arrived at receiver', detail: 'Seal 0048213 matches pickup', state: 'ok' },
  { time: '17:05', label: 'Count reconciled', detail: '412 sent, 409 received', state: 'warn' },
] as const

export function EvidenceSection() {
  return (
    <section aria-labelledby="evidence-heading" className="py-24 md:py-36">
      <div className={cn(container, 'grid items-center gap-14 md:grid-cols-[1fr_1.05fr] md:gap-20')}>
        <div>
          <h2 id="evidence-heading" className={sectionHeading}>When a load is disputed, you open the record.</h2>
          <ul className="mt-10 space-y-7">
            {[
              ['Every handover, in order', 'Who did it, where, when, and against which plan. The trip’s position is worked out from what actually happened, never typed in.'],
              ['Independent sources, side by side', 'The driver’s phone and the vehicle’s tracker report separately. When they disagree, the disagreement itself is on the record.'],
              ['A receipt anyone can check', 'Each record’s fingerprint sits on a public ledger, so you can show a claims handler that nothing was edited after the fact.'],
            ].map(([title, body]) => (
              <li key={title} className="border-l border-outline-v/60 pl-5">
                <h3 className="text-[1.125rem] font-bold tracking-[-0.01em] text-on-surf">{title}</h3>
                <p className="mt-1.5 text-[1rem] leading-relaxed text-on-surf-v">{body}</p>
              </li>
            ))}
          </ul>
        </div>

        <figure aria-label="Sample trip timeline" className="rounded-xl border border-outline-v/40 bg-surf-lowest p-6 shadow-level-3 md:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-[1.125rem] font-bold text-on-surf">Trip FP-0391</p>
            <p className="text-[0.8125rem] text-on-surf-v">Johannesburg → Durban</p>
          </div>
          <ol className="mt-6">
            {SAMPLE_TIMELINE.map((row, i) => (
              <li key={row.label} className="relative grid grid-cols-[auto_20px_minmax(0,1fr)] gap-3 pb-6 last:pb-0">
                <span className="pt-0.5 text-[0.8125rem] font-medium tabular-nums text-on-surf-v">{row.time}</span>
                <span className="relative flex justify-center">
                  {i < SAMPLE_TIMELINE.length - 1 && <span className="absolute top-5 h-[calc(100%+4px)] w-px bg-outline-v/60" />}
                  <span className={cn(
                    'relative mt-0.5 grid h-5 w-5 place-items-center rounded-full',
                    row.state === 'ok' ? 'bg-chain-c text-chain-onc' : 'bg-warn-c text-warn-onc',
                  )}>
                    {row.state === 'ok' ? <Check className="h-3 w-3" strokeWidth={3} /> : <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />}
                  </span>
                </span>
                <span>
                  <span className="block text-[0.9375rem] font-semibold text-on-surf">{row.label}</span>
                  <span className="block text-[0.875rem] tabular-nums text-on-surf-v">{row.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-6 rounded-lg bg-warn-c/40 px-4 py-3 text-[0.875rem] leading-relaxed text-warn-onc">
            The seal matched at both ends, so the shortfall happened at the receiver’s dock and not
            on the road. That’s a different claim, with different evidence behind it.
          </p>
          <figcaption className="mt-5 border-t border-dashed border-outline-v/50 pt-3 text-[0.75rem] text-on-surf-v">
            Sample trip. Values are illustrative.
          </figcaption>
        </figure>
      </div>
    </section>
  )
}

const PRINCIPLES = [
  {
    title: 'Evidence, not operations.',
    body: 'FreightProof doesn’t reroute trucks or replace your tracking, manifest or gate-security systems. It records the moments between them.',
  },
  {
    title: 'Your people’s data stays in South Africa.',
    body: 'Identities, locations and photos are stored in Cape Town (AWS af-south-1). Only a SHA-256 fingerprint goes to the public ledger, and it reveals nothing about anyone. POPIA by design.',
  },
  {
    title: 'No new logins at the gate.',
    body: 'Guards and warehouse staff don’t need accounts. The driver is the only hands-on user, and the receiver confirms with a one-time PIN.',
  },
] as const

export function PrinciplesSection() {
  return (
    <section aria-labelledby="principles-heading" className="border-y border-outline-v/40 bg-surf-low py-24 md:py-32">
      <div className={cn(container, 'grid gap-12 md:grid-cols-[0.9fr_1.1fr] md:gap-20')}>
        <h2 id="principles-heading" className={sectionHeading}>Built for how freight actually moves.</h2>
        <dl className="divide-y divide-outline-v/50 border-y border-outline-v/50">
          {PRINCIPLES.map(p => (
            <div key={p.title} className="py-7">
              <dt className="text-[1.25rem] font-bold tracking-[-0.015em] text-on-surf">{p.title}</dt>
              <dd className="mt-2 max-w-[60ch] text-[1rem] leading-relaxed text-on-surf-v">{p.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

function initials(name: string): string {
  return name.split(' ').map(part => part[0]).join('').slice(0, 2)
}

export function AboutSection() {
  return (
    <section id={SECTIONS.about} aria-labelledby="about-heading" className="scroll-mt-16 py-24 md:py-36">
      <div className={cn(container, 'grid gap-14 md:grid-cols-[1.1fr_0.9fr] md:gap-20')}>
        <div>
          <h2 id="about-heading" className={sectionHeading}>Built in Cape Town, for South African roads.</h2>
          <div className={cn(lede, 'mt-8 max-w-[58ch] space-y-5')}>
            <p>
              FreightProof started in 2026 as an Honours project at the University of Cape Town.
              It was shaped by a site visit to a working distribution hub and by people who move
              freight on South African corridors every day.
            </p>
            <p>
              We kept hearing the same thing: when a load disappears, everyone has a log and nobody
              has proof. So we built the record that sits between the systems, so that the truth
              about a handover doesn’t depend on who tells the story.
            </p>
          </div>
        </div>

        <ul className="self-end divide-y divide-outline-v/40 border-y border-outline-v/40" aria-label="Co-founders">
          {TEAM.map(person => (
            <li key={person.name} className="flex items-center gap-4 py-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-[0.9375rem] font-bold tracking-[0.02em] text-white" aria-hidden="true">
                {initials(person.name)}
              </span>
              <span>
                <span className="block text-[1.0625rem] font-semibold text-on-surf">{person.name}</span>
                <span className="block text-[0.875rem] text-on-surf-v">{person.role}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
