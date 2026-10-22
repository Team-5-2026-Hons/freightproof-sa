import type { ReactNode } from 'react'

export interface ChapterLink {
  n: number
  id: string
  title: string
}

// Numbered to match the PDF's sections 1–6, so two people holding the web copy and the
// printed copy can refer to "section 3" and mean the same thing.
export const CHAPTERS = {
  summary: { n: 1, id: 'ch-summary', title: 'Summary and findings' },
  journey: { n: 2, id: 'ch-journey', title: 'Journey and custody' },
  exceptions: { n: 3, id: 'ch-exceptions', title: 'Exceptions and response' },
  details: { n: 4, id: 'ch-details', title: 'Trip, vehicles, driver and cargo' },
  verification: { n: 5, id: 'ch-verification', title: 'Verification' },
  dataProtection: { n: 6, id: 'ch-data-protection', title: 'Data protection' },
} as const satisfies Record<string, ChapterLink>

interface ChapterProps {
  chapter: ChapterLink
  lede?: string
  children: ReactNode
}

// `chapter` class: the print stylesheet lets a chapter break across pages while keeping each card whole.
// scroll-mt: a jump from the contents lands below the sticky section bar on narrow screens.
export function Chapter({ chapter, lede, children }: ChapterProps) {
  return (
    <section id={chapter.id} aria-labelledby={`${chapter.id}-title`} className="chapter scroll-mt-20 lg:scroll-mt-6">
      <header className="mb-4 border-t-[3px] border-ink pt-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Section {chapter.n}</p>
        <h2 id={`${chapter.id}-title`} className="mt-0.5 text-[22px] font-extrabold leading-tight tracking-[-0.01em]">{chapter.title}</h2>
        {lede && <p className="mt-1 max-w-2xl text-[14px] text-muted">{lede}</p>}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
