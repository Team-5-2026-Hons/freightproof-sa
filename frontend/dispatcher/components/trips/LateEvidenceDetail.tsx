'use client'

import type { LateEvidenceDetailRead } from '@shared/lib/types/driver-substitution'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { EvidencePhoto } from '@/components/domain/EvidencePhoto'

interface Props {
  item: LateEvidenceDetailRead
  onRetry?: () => void
}

export function LateEvidenceDetail({ item, onRetry }: Props): React.JSX.Element {
  const evidence = item.evidence
  let detail: React.ReactNode
  switch (evidence.kind) {
    case 'exception':
      detail = <><p>{evidence.payload.description}</p><p>Reported {evidence.payload.exception_type.replaceAll('_', ' ')}</p></>
      break
    case 'checkpoint':
      detail = <><p>Checkpoint: {evidence.payload.checkpoint_type}</p>{evidence.payload.note && <p>{evidence.payload.note}</p>}{evidence.payload.is_deviation && <p>Driver reported a deviation</p>}</>
      break
    case 'location':
      detail = <ul>{evidence.payload.pings.map((ping, index) => <li key={`${ping.recorded_at}:${index}`}>
        {ping.recorded_at}: {ping.lat}, {ping.lng}{ping.accuracy_m != null && ` · accuracy ${ping.accuracy_m} m`} · {ping.context}
      </li>)}</ul>
      break
    case 'phase': {
      const payload = evidence.payload
      detail = <><p>{PHASE_NAMES[payload.phase_type]} declaration</p>
        {'seal_number' in payload && <p>Seal: {payload.seal_number}</p>}
        {'seal_condition' in payload && <p>Seal condition: {payload.seal_condition}{payload.seal_number_at_arrival && ` · ${payload.seal_number_at_arrival}`}</p>}
        {'driver_visual_count' in payload && payload.driver_visual_count != null && <p>Driver count: {payload.driver_visual_count}</p>}
      </>
      break
    }
  }
  const payload = evidence.payload
  return <section aria-label="Retained evidence contents" className="my-2 flex flex-col gap-2">
    {detail}
    {'driver_phone_lat' in payload && payload.driver_phone_lat != null && <p>Phone: {payload.driver_phone_lat}, {payload.driver_phone_lng} · recorded observation</p>}
    <div className="flex flex-wrap gap-3">{item.artifacts.map((artifact, index) => (
      <EvidencePhoto key={artifact.id} label={`Retained photo ${index + 1}`} artifact={artifact} onRetry={onRetry} />
    ))}</div>
  </section>
}
