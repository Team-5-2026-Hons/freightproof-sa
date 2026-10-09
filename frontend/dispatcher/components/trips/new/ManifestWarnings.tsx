'use client'

import { Button } from '@/components/ui/Button'
import { Ic, type IconName } from '@/components/ui/Ic'
import { RecordLink } from '@/components/ui/RecordLink'
import { ROUTES } from '@/lib/constants/routes'
import type { PPManifestWarning, PPManifestWarningCode } from '@shared/lib/types/pp-manifest'

// Non-blocking warnings ask the dispatcher for something or inform them. Each gets a
// neutral row and an icon naming what it is about. Colour stays reserved for the blocking
// case (DESIGN_SYSTEM.md §1.2: colour is information).
const PROMPT_ICON: Partial<Record<PPManifestWarningCode, IconName>> = {
  MANIFEST_NOT_CLOSED: 'file',
}

// Prompts the form itself answers: the precinct picker appears with its own hint, and an
// empty departure is a required field. Listing them here as well said everything twice.
const ANSWERED_BY_THE_FORM: readonly PPManifestWarningCode[] = [
  'ORIGIN_HUB_UNLINKED', 'DESTINATION_HUB_UNLINKED', 'NO_PLANNED_TIMES',
]

export interface ManifestWarningsProps {
  warnings: readonly PPManifestWarning[]
  /** Offered for a manifest with no waybills: the trip is an empty leg, not a manifest trip. */
  onEmptyLeg: () => void
}

export function ManifestWarnings({ warnings, onEmptyLeg }: ManifestWarningsProps): React.JSX.Element | null {
  const blocking = warnings.filter(warning => warning.blocking)
  const prompts = warnings.filter(warning => !warning.blocking && !ANSWERED_BY_THE_FORM.includes(warning.code))
  if (blocking.length === 0 && prompts.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {blocking.length > 0 && (
        <div role="alert" className="rounded-lg bg-err-c px-4 py-3 text-err-onc">
          <p className="flex items-center gap-2 text-[13px] font-[700]">
            <Ic n="warn" s={14} className="text-err" />
            This manifest cannot become a trip
          </p>
          <ul className="mt-2 flex flex-col gap-3 pl-6 text-[12px] leading-relaxed">
            {blocking.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                <p>{warning.message}</p>
                {warning.waybills.length > 0 && (
                  <p className="mt-0.5 font-[600] tabular-nums tracking-[0.03em]">{warning.waybills.join(', ')}</p>
                )}
                {/* Only our own organisation's trips come with an id (piece A keeps foreign
                    holders private), so a missing id means "nothing to open". */}
                {warning.trip_id && (
                  <RecordLink href={ROUTES.tripDetail(warning.trip_id)}>
                    Open {warning.trip_reference ?? 'that trip'}
                  </RecordLink>
                )}
                {warning.code === 'NO_WAYBILLS' && (
                  <Button variant="secondary" size="sm" className="mt-2" onClick={onEmptyLeg}>
                    Create an empty leg instead
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {prompts.length > 0 && (
        <ul aria-label="Manifest notices" className="flex flex-col gap-2">
          {prompts.map((warning, index) => (
            <li
              key={`${warning.code}-${index}`}
              className="flex items-start gap-2 rounded-lg bg-surf-low px-4 py-3 text-[12px] leading-relaxed text-on-surf"
            >
              <Ic n={PROMPT_ICON[warning.code] ?? 'warn'} s={14} className="mt-[2px] text-on-surf-v" />
              {warning.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
