import type { ReactNode } from 'react'

interface Props {
  title: string
  children: ReactNode
}

/** One zone of a phase card: a labelled region, so the three read as separate kinds of
 *  information (what happened, was it right, can it be proved). */
export function PhaseZone({ title, children }: Props) {
  return (
    <section aria-label={title}>
      <h4 className="mb-2 text-label uppercase text-on-surf-v">{title}</h4>
      {children}
    </section>
  )
}
