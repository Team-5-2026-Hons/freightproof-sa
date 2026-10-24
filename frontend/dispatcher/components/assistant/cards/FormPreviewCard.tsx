'use client'

import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { FormPreviewCard, RecordRef } from '@shared/lib/types/assistant'
import { ASSISTANT_COPY } from '../assistantCopy'
import { CardLink, CardShell, Muted, hrefFor, type CardProps } from './parts'

function Value({ record, onNavigate }: { record: RecordRef | null } & CardProps) {
  if (record === null) return <Muted>{ASSISTANT_COPY.youFillIn}</Muted>
  return <CardLink href={hrefFor(record)} onNavigate={onNavigate}>{record.label}</CardLink>
}

/** What "Open trip form" will fill in, and anything to check first (spec D2a, D2b). Nothing is saved by the click. */
export function FormPreviewCardView({ card, onNavigate }: { card: FormPreviewCard } & CardProps) {
  const rows: [string, React.ReactNode][] = [
    [ASSISTANT_COPY.formMode, card.mode === 'manifest' ? `${ASSISTANT_COPY.fromManifest} ${card.manifest_number ?? ''}` : ASSISTANT_COPY.emptyLeg],
    ...(card.manifest_summary ? [[ASSISTANT_COPY.formManifest, card.manifest_summary] as [string, React.ReactNode]] : []),
    [ASSISTANT_COPY.formDriver, <Value key="d" record={card.driver} onNavigate={onNavigate} />],
    [ASSISTANT_COPY.formHorse, <Value key="h" record={card.horse} onNavigate={onNavigate} />],
    [ASSISTANT_COPY.formTrailers, card.trailers.length ? card.trailers.map((t) => t.label).join(', ') : <Muted key="t">{ASSISTANT_COPY.none}</Muted>],
  ]
  if (card.mode === 'empty_leg') {
    rows.push(
      [ASSISTANT_COPY.formFrom, <Value key="o" record={card.origin} onNavigate={onNavigate} />],
      [ASSISTANT_COPY.formTo, <Value key="x" record={card.destination} onNavigate={onNavigate} />],
    )
  }
  const time = (value: string | null): React.ReactNode =>
    value ? fmtDateTime(value) : <Muted>{card.mode === 'manifest' ? ASSISTANT_COPY.manifestTime : ASSISTANT_COPY.youFillIn}</Muted>
  rows.push([ASSISTANT_COPY.formDeparture, time(card.departure)], [ASSISTANT_COPY.formArrival, time(card.arrival)])
  return (
    <CardShell title={ASSISTANT_COPY.formTitle}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-on-surf-v">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {card.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-warn">
          {card.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      <Muted className="text-[11px]">{ASSISTANT_COPY.nothingSaved}</Muted>
    </CardShell>
  )
}
