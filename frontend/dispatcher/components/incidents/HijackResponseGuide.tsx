'use client'

import { fmtSastDateTime } from '@shared/lib/utils/datetime'
import { Button } from '@/components/ui/Button'
import { RESPONSE_STEP_ACTION, RESPONSE_STEP_LABELS } from '@/lib/format/incident'
import type { IncidentExternalAction, ResponseStep, ResponseStepState } from '@/lib/types/incident'

interface Props {
  steps: ResponseStep[]
  closed: boolean
  tripLive: boolean
  documentUploadEnabled: boolean
  onStopTrip: () => void
  onRecordAction: (action: IncidentExternalAction) => void
  onRecordSaps: () => void
  onAttachCaseSlip: () => void
  onIssuePack: () => void
  onDownloadSheet: () => void
}

const STATE_TEXT: Record<ResponseStepState, string> = {
  done: 'Done',
  in_progress: 'In progress',
  todo: 'To do',
  not_applicable: 'Not needed',
}

const STATE_DOT: Record<ResponseStepState, string> = {
  done: 'bg-ok',
  in_progress: 'bg-warn',
  todo: 'bg-outline-v',
  not_applicable: 'bg-surf-high',
}

/**
 * The steps after a hijacking, in the order a dispatcher takes them. Each is ticked by what
 * was recorded (an action on the ledger, a SAPS declaration, an issued pack), never by a
 * checkbox, so the guide cannot claim a step nobody recorded. FreightProof records each
 * response; it does not contact SAPS, the insurer or anyone else.
 */
export function HijackResponseGuide(props: Props): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-on-surf-v">
        FreightProof records each step; it does not contact SAPS, the insurer or the tracking company for you.
      </p>
      <ol className="flex flex-col divide-y divide-outline-v/30 rounded-md border border-outline-v/30">
        {props.steps.map((step, index) => (
          <li key={step.key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${STATE_DOT[step.state]}`} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-on-surf">{index + 1}. {RESPONSE_STEP_LABELS[step.key]}</p>
                <p className="text-xs text-on-surf-v">
                  {STATE_TEXT[step.state]}{step.done_at ? ` · ${fmtSastDateTime(step.done_at)}` : ''}{step.detail ? ` · ${step.detail}` : ''}
                </p>
              </div>
            </div>
            {!props.closed && <StepActions step={step} {...props} />}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={props.onDownloadSheet}>Download SAPS fact sheet</Button>
      </div>
    </div>
  )
}

function StepActions({ step, tripLive, documentUploadEnabled, onStopTrip, onRecordAction, onRecordSaps, onAttachCaseSlip, onIssuePack }: Props & { step: ResponseStep }): React.JSX.Element | null {
  if (step.state === 'done' || step.state === 'not_applicable') {
    // Done steps can still take a correction or a second record, except the trip stop.
    if (step.key === 'saps_reported') return <Button size="sm" variant="ghost" onClick={onRecordSaps}>Add details</Button>
    return null
  }
  if (step.key === 'trip_stopped') {
    return tripLive ? <Button size="sm" variant="danger" onClick={onStopTrip}>Stop trip</Button> : null
  }
  if (step.key === 'saps_reported') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onRecordSaps}>Record SAPS details</Button>
        {documentUploadEnabled && <Button size="sm" variant="ghost" onClick={onAttachCaseSlip}>Attach case slip</Button>}
      </div>
    )
  }
  if (step.key === 'audit_pack_issued') return <Button size="sm" variant="secondary" onClick={onIssuePack}>Issue audit pack</Button>
  const action = RESPONSE_STEP_ACTION[step.key]
  return action ? <Button size="sm" variant="secondary" onClick={() => onRecordAction(action)}>Record</Button> : null
}
