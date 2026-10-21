'use client'

import { useEffect, useState } from 'react'
import type { ChapterLink } from './Chapter'

// A band across the middle of the viewport: the section crossing it is the one being read.
const READING_BAND = '-35% 0px -60% 0px'

/**
 * The pack's contents: a sticky sidebar on wide screens, a sticky scrolling bar on narrow ones.
 * The section being read is marked, so the reader always knows where they are in a long pack.
 */
export function ChapterNav({ chapters }: { chapters: readonly ChapterLink[] }) {
  const [active, setActive] = useState<string>(chapters[0]?.id ?? '')

  useEffect(() => {
    // Absent in some embedded browsers and in jsdom: the links still work, only the marker stays put.
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting)
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: READING_BAND },
    )
    for (const chapter of chapters) {
      const element = document.getElementById(chapter.id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [chapters])

  return (
    // z above Leaflet's own controls (z-index 1000), which would otherwise scroll over the bar.
    <nav
      aria-label="Sections"
      className="no-print sticky top-0 z-[1100] -mx-4 border-b border-outline-v/60 bg-surf/95 px-4 py-1.5 backdrop-blur sm:-mx-8 sm:px-8 lg:top-6 lg:mx-0 lg:mt-6 lg:self-start lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
    >
      <p className="mb-2 hidden text-[11px] font-bold uppercase tracking-[0.1em] text-muted lg:block">Contents</p>
      <ol className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {chapters.map((chapter) => {
          const current = chapter.id === active
          return (
            <li key={chapter.id} className="shrink-0">
              <a
                href={`#${chapter.id}`}
                aria-current={current ? 'location' : undefined}
                className={`flex min-h-11 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold transition-colors lg:whitespace-normal lg:py-1.5 ${
                  current ? 'bg-ink text-white' : 'text-ink hover:bg-surf-high'
                }`}
              >
                <span className={`num text-[12px] ${current ? 'text-white/70' : 'text-muted'}`}>{chapter.n}</span>
                {chapter.title}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
