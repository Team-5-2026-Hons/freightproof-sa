import type { ReactNode } from 'react'
import Link from 'next/link'
import { ROUTES } from '@/lib/constants/routes'
import { LEGAL_LAST_UPDATED } from '@/lib/landing/content'
import { cn } from '@shared/lib/utils/cn'

const LEGAL_PAGES = [
  { href: ROUTES.legalPrivacy, label: 'Privacy Notice' },
  { href: ROUTES.legalTerms, label: 'Terms of Use' },
  { href: ROUTES.legalCookies, label: 'Cookie Notice' },
  { href: ROUTES.legalCompany, label: 'PAIA & ECT Act' },
] as const

interface LegalDocProps {
  title: string
  current: (typeof LEGAL_PAGES)[number]['href']
  intro: ReactNode
  children: ReactNode
}

/** Shared frame for every legal page: title, date, sibling links, and readable prose. */
export function LegalDoc({ title, current, intro, children }: LegalDocProps) {
  return (
    <div className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,1fr)] gap-12 px-4 pb-28 pt-14 md:grid-cols-[220px_minmax(0,1fr)] md:gap-16 md:px-8 md:pt-20">
      <nav aria-label="Legal documents" className="md:sticky md:top-24 md:self-start">
        <ul className="flex flex-wrap gap-2 md:flex-col md:gap-1">
          {LEGAL_PAGES.map(page => (
            <li key={page.href}>
              <Link
                href={page.href}
                aria-current={page.href === current ? 'page' : undefined}
                className={cn(
                  'flex min-h-[44px] items-center rounded-md px-3 text-[0.875rem] font-medium transition-colors md:min-h-[36px]',
                  page.href === current ? 'bg-surf-high text-on-surf' : 'text-on-surf-v hover:bg-surf-high/60 hover:text-on-surf',
                )}
              >
                {page.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <article
        className={cn(
          'max-w-[72ch] text-[1rem] leading-[1.7] text-on-surf-v',
          '[&_h2]:mb-3 [&_h2]:mt-12 [&_h2]:text-[1.375rem] [&_h2]:font-bold [&_h2]:leading-snug [&_h2]:tracking-[-0.015em] [&_h2]:text-on-surf',
          '[&_h3]:mb-2 [&_h3]:mt-7 [&_h3]:text-[1.0625rem] [&_h3]:font-semibold [&_h3]:text-on-surf',
          '[&_p]:mb-4 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5',
          '[&_a]:font-medium [&_a]:text-sec [&_a]:underline [&_a]:underline-offset-[3px]',
          '[&_strong]:font-semibold [&_strong]:text-on-surf',
        )}
      >
        <h1 className="text-balance text-[min(2.25rem,10vw)] font-extrabold leading-[1.05] tracking-[-0.035em] text-on-surf md:text-[min(3.25rem,4.5vw)]">{title}</h1>
        <p className="mt-4 text-[0.875rem]">Last updated {LEGAL_LAST_UPDATED}</p>
        <div className="mt-8 text-[1.125rem] leading-relaxed">{intro}</div>
        {children}
      </article>
    </div>
  )
}

/** Two-column facts table (company particulars, storage keys). */
export function LegalTable({ caption, head, rows }: { caption: string; head: readonly string[]; rows: readonly (readonly ReactNode[])[] }) {
  return (
    <div className="mb-6 overflow-x-auto rounded-lg border border-outline-v/50">
      <table className="w-full min-w-[520px] border-collapse text-left text-[0.875rem]">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surf-low">
          <tr>
            {head.map(cell => (
              <th key={cell} scope="col" className="px-4 py-3 font-semibold text-on-surf">{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-v/40">
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {row.map((cell, j) => (
                <td key={j} className={cn('px-4 py-3', j === 0 && 'font-medium text-on-surf')}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
