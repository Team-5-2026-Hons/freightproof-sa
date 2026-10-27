'use client'

import type { ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, Clock, ShieldCheck } from 'lucide-react'
import { ROUTES, PANIC_AT_PARAM, PANIC_LOCATED_PARAM, PANIC_QUEUED_PARAM } from '@/lib/constants/routes'
import { markTransition } from '@/lib/navigation/transition-direction'
import { formatTimeWithSeconds } from '@/lib/utils/format-time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { CallDispatch } from '@/components/trip/CallDispatch'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 py-2">
      <dt className="text-body text-surface-on">{label}</dt>
      <dd className="text-body font-semibold tabular-nums">{children}</dd>
    </div>
  )
}

/**
 * After a panic swipe: what happened to THIS alert, then
 * the two things a driver can still do — call dispatch, or go back to the drive.
 */
export default function PanicSubmittedPageClient() {
  const router = useRouter()
  const params = useSearchParams()
  const queued = params.get(PANIC_QUEUED_PARAM) === '1'
  const at = params.get(PANIC_AT_PARAM)
  const located = params.get(PANIC_LOCATED_PARAM)

  return (
    <main className="flex min-h-dvh flex-col bg-surface px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-[calc(env(safe-area-inset-top)+5rem)]">
      <div className="flex flex-col items-center text-center">
        <span className={cn('flex size-28 items-center justify-center rounded-full', queued ? 'bg-attention-tint' : 'bg-success-tint')}>
          <span className={cn('flex size-20 items-center justify-center rounded-full', queued ? 'bg-attention text-surface' : 'bg-success text-success-on')}>
            {queued
              ? <Clock className="size-10" strokeWidth={2} aria-hidden />
              : <Check className="size-10" strokeWidth={2.6} aria-hidden />}
          </span>
        </span>
        <h1 className="mt-6 text-large-title font-extrabold tracking-tight text-surface-on">{queued ? 'Alert saved' : 'Alert sent'}</h1>
        <p className="mt-2.5 text-body text-surface-on-variant">
          {queued
            ? 'No signal right now. The alert is stored on this device and sends the moment you’re back in range.'
            : 'Your dispatcher has been notified. Stay where it’s safe and wait for contact.'}
        </p>
      </div>

      <dl className="mt-8 divide-y divide-hairline rounded-[18px] bg-fill px-4 text-surface-on">
        {at !== null && <Fact label={queued ? 'Recorded' : 'Sent'}>{formatTimeWithSeconds(at)}</Fact>}
        {located !== null && (
          <Fact label="Location">
            {located === '1'
              ? <span className="text-success-ink">Attached</span>
              : <span className="font-normal text-surface-on-variant">Not available</span>}
          </Fact>
        )}
        {queued ? (
          <Fact label="Status"><span className="text-attention-ink">Waiting for signal</span></Fact>
        ) : (
          <Fact label="Record">
            <span className="inline-flex items-center gap-1.5 text-chain">
              <ShieldCheck className="size-4" strokeWidth={2.4} aria-hidden />
              Timestamped
            </span>
          </Fact>
        )}
      </dl>
      {queued && (
        <p className="mt-4 text-center text-subhead text-surface-on-variant">If you can, call for help directly too.</p>
      )}

      <div className="mt-auto flex flex-col gap-2.5 pt-8">
        <CallDispatch />
        <Button variant="fill" size="pill" onClick={() => { markTransition('back'); router.replace(ROUTES.inTransit) }}>
          Back to In Transit
        </Button>
      </div>
    </main>
  )
}
