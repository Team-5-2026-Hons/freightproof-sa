import { Field, Section } from './PhaseDetailFields'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

/** Shows a dispatcher's override of this phase's checks. Renders nothing when there was none. */
export function PhaseOverrideSection({ phase }: { phase: PhaseDescriptor }) {
  if (phase.dispatcher_override_note === null && phase.dispatcher_override_user_id === null) {
    return null
  }

  return (
    <Section title="Dispatcher override">
      <div className="col-span-2 text-[11px] font-[600] text-warn mb-[2px]">
        ⚠ A dispatcher bypassed this phase&apos;s checks
      </div>
      <Field label="Note" value={phase.dispatcher_override_note} span />
      {/* The id, not a name — the trip payload carries no user directory to resolve it against. */}
      <Field label="Authorised by (user id)" value={phase.dispatcher_override_user_id} mono span />
    </Section>
  )
}
