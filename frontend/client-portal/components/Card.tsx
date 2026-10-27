import type { ReactNode } from 'react'

interface CardProps {
  title: string
  id?: string
  aside?: ReactNode
  children: ReactNode
}

export function Card({ title, id, aside, children }: CardProps) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="min-w-0 rounded-lg bg-surf-lowest p-4 shadow-card sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id={id ? `${id}-title` : undefined} className="text-subhead font-bold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,40%)_1fr] items-baseline gap-3 border-b border-outline-v/40 py-2 text-body last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}
