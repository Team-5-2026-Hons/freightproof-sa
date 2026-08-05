import { Field, Section } from './PhaseDetailFields'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

/**
 * A dispatcher's override of this phase's checks.
 *
 * Renders nothing when there was no override, which is the normal case — but when there
 * WAS one, a human bypassed a gate the evidence model relies on, and that is never a
 * footnote. Shared by every phase type on purpose: this used to live inside
 * ActivationDetail, so an override on departure, unloading or confirmation — where the
 * seal and the proof of delivery are captured — was recorded by the backend and shown
 * nowhere at all.
 */
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
      {/* The id, not a name — the trip payload carries no user directory to resolve it
          against. An unresolved id is still accountability; omitting it is not. */}
      <Field label="Authorised by (user id)" value={phase.dispatcher_override_user_id} mono span />
    </Section>
  )
}
