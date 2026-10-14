import type { ReactNode } from 'react'

interface CardProps {
  title: string
  id?: string
  aside?: ReactNode
  children: ReactNode
}

// min-w-0: a grid item defaults to min-width:auto, so a wide table inside its scroll box
// would otherwise stretch the whole column past a phone's screen.
export function Card({ title, id, aside, children }: CardProps) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="min-w-0 rounded-lg bg-surf-lowest p-4 shadow-card sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id ? `${id}-title` : undefined} className="text-[15px] font-extrabold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,40%)_1fr] gap-3 border-b border-outline-v/40 py-1.5 text-[13px] last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}
