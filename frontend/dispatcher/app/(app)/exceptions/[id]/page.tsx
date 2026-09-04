'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TopBar }     from '@/components/ui/TopBar'
import { SecHead }    from '@/components/ui/SecHead'
import { Chip }       from '@/components/ui/Chip'
import { Button }     from '@/components/ui/Button'
import { Ic }         from '@/components/ui/Ic'
import { Input }      from '@/components/ui/Input'
import { Select }     from '@/components/ui/Select'
import { Spinner }    from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { TripIdStamp } from '@/components/domain/TripIdStamp'
import { ApiError }      from '@/lib/api/client'
import { useToast }      from '@/lib/hooks/useToast'
import { useExceptions, resolveException } from '@/lib/hooks/useExceptions'
import type { ExceptionResolutionMethod } from '@shared/lib/types/exception'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META } from '@shared/lib/constants/status-meta'
import { COPY }   from '@shared/lib/constants/copy'
import { ROUTES } from '@/lib/constants/routes'

const RESOLUTION_METHOD_LABELS: Record<ExceptionResolutionMethod, string> = {
  phoned:         'Phoned the driver',
  whatsapp:       'WhatsApp',
  in_person:      'In person',
  no_contact_yet: 'No contact — resolved from evidence',
}

function fmtType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function ExceptionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { notify } = useToast()

  const exceptionId = params.id as string
  // No `resolved` filter: this page is reached by permalink and must be able to open a
  // resolved exception as readily as an open one.
  const { exceptions, isLoading, error, refetchSilent } = useExceptions()
  const exception = useMemo(
    () => exceptions.find(e => e.id === exceptionId),
    [exceptions, exceptionId],
  )

  const [resolutionNote, setResolutionNote]   = useState('')
  const [resolutionMethod, setResolutionMethod] =
    useState<ExceptionResolutionMethod>('phoned')
  const [resolving, setResolving]             = useState(false)

  // ── Loading ──────────────────────────────────────────────────────────────────
  // Ranked ahead of the not-found branch below. Without it a slow fetch renders
  // "Exception not found" for a record that exists and is merely still in flight —
  // telling a dispatcher chasing a live incident that their evidence is gone.
  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <TopBar title="Exception Detail" />
        <div className="flex-1 flex items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  // ── Load failed ──────────────────────────────────────────────────────────────
  // Only when there is nothing to show. The hook refetches on EVERY trip event in the
  // organisation, so without the `!exception` gate one failed background refresh would
  // tear down this page mid-use — taking the resolve form with it and destroying a
  // half-typed account of a live incident. If the exception is already in hand, the page
  // stays up and a stale read is strictly better than a lost note.
  if (error && !exception) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <TopBar title="Exception Detail">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
            onClick={() => router.back()}
          >
            Back
          </Button>
        </TopBar>
        <div className="flex-1 overflow-auto p-6">
          <EmptyState
            icon={<Ic n="warn" s={32} className="text-err" />}
            title="Could not load this exception"
            body={error}
            cta={<Button onClick={() => router.push(ROUTES.exceptions)}>Back to Exceptions</Button>}
          />
        </div>
      </div>
    )
  }

  // ── Not found ────────────────────────────────────────────────────────────────
  if (!exception) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <TopBar title="Exception Detail">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
            onClick={() => router.back()}
          >
            Back
          </Button>
        </TopBar>
        <div className="flex-1 overflow-auto p-6">
          <EmptyState
            icon={<Ic n="warn" s={32} className="text-on-surf-v" />}
            title="Exception not found"
            body="This record does not exist or you do not have access to it."
            cta={
              <Button onClick={() => router.push(ROUTES.exceptions)}>
                Back to Exceptions
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const sevMeta = EXCEPTION_SEVERITY_META[exception.severity]
  const srcMeta = EXCEPTION_SOURCE_META[exception.source]

  const handleResolve = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!resolutionNote.trim()) return
    setResolving(true)
    try {
      await resolveException(exceptionId, {
        resolver_note: resolutionNote.trim(),
        resolution_method: resolutionMethod,
      })
      notify({ kind: 'success', title: COPY.toast.exceptionResolved })
      // No refetch before navigating: this hook instance dies with the page, and
      // useAsyncData's mountedRef discards a result that lands after unmount. The list
      // mounts its own hook and fetches on mount, so it is already current on arrival.
      router.push(ROUTES.exceptions)
    } catch (err) {
      // Surfaced, never swallowed. This used to be a 600ms timer followed by an
      // unconditional success toast — it reported a resolution that had never been
      // recorded anywhere, on the one screen whose job is to prove otherwise.
      const lostTheRace = err instanceof ApiError && err.status === 409
      notify({
        kind: 'error',
        title: lostTheRace ? 'Already resolved by a colleague' : 'Could not resolve this exception',
        body: err instanceof Error ? err.message : 'Please try again.',
      })
      // Deliberately stay on the page and refetch rather than navigating away. Their note
      // is still in the textarea, and the refetch swaps the form for the resolution that
      // won — so they can read what their colleague established and judge whether theirs
      // adds anything, instead of being bounced to a list that just says "resolved".
      if (lostTheRace) refetchSilent()
      setResolving(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title={fmtType(exception.exception_type)}
        sub={`${sevMeta.label} · ${exception.resolved ? 'Resolved' : 'Open'}`}
      >
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
          onClick={() => router.back()}
        >
          Back
        </Button>
      </TopBar>

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-4">

          {/* Related trip banner */}
          {/* Reference and id both ride on the exception itself (denormalised off the
              org-scoping join), so this banner costs no second request. */}
          {exception.trip_reference && (
            <div className="bg-surf-low rounded-lg px-5 py-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-1">
                  Related Trip
                </div>
                <TripIdStamp tripReference={exception.trip_reference} />
              </div>
              <button
                onClick={() => router.push(ROUTES.tripDetail(exception.trip_id))}
                className="flex items-center gap-1 text-[13px] font-[600] text-sec hover:opacity-75 transition-opacity"
              >
                View trip <Ic n="chev" s={14} className="text-sec" />
              </button>
            </div>
          )}

          {/* Exception detail card */}
          <div className="bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden">
            <SecHead title="Exception Details" />
            <div className="p-6">

              {/* Chips + source row */}
              <div className="flex items-center gap-2 mb-5 flex-wrap">
                <Chip type={sevMeta.chipType} label={sevMeta.label} />
                <Chip
                  type={exception.resolved ? 'complete' : 'critical'}
                  label={exception.resolved ? 'Resolved' : 'Open'}
                />
                <span className="ml-auto text-[11px] text-on-surf-v font-[500]">
                  {srcMeta.label} · {fmtTs(exception.created_at)}
                </span>
              </div>

              {/* Description */}
              <div className="bg-surf-low rounded-lg p-4 mb-5">
                <p className="text-[14px] text-on-surf leading-relaxed">{exception.description}</p>
              </div>

              {/* Meta rows */}
              <div className="flex flex-col">
                {([
                  ['Source',  srcMeta.label],
                  ['Raised',  fmtTs(exception.created_at)],
                  ['Updated', fmtTs(exception.updated_at)],
                  ...(exception.resolved && exception.resolved_at
                    ? [['Resolved', fmtTs(exception.resolved_at)]] as [string, string][]
                    : []),
                ] as [string, string][]).map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-start gap-3 py-2 border-b border-outline-v/10 last:border-0"
                  >
                    <span className="text-[11px] text-on-surf-v w-24 shrink-0 pt-px">{label}</span>
                    <span className="text-[13px] font-[500] text-on-surf">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Resolution card */}
          {exception.resolved ? (
            <div className="bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden">
              <SecHead title="Resolution" />
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Ic n="check" s={16} className="text-ok shrink-0" />
                  <span className="text-[14px] font-[700] text-ok">Exception resolved</span>
                </div>
                <div className="bg-surf-low rounded-lg p-4 mb-4">
                  <p className="text-[14px] text-on-surf leading-relaxed">
                    {exception.resolver_note ?? 'No note provided.'}
                  </p>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  {exception.resolved_at && (
                    <div className="flex items-center gap-1.5 text-[11px] font-[500] text-sec tabular-nums">
                      <Ic n="clock" s={10} className="text-sec shrink-0" />
                      {fmtTs(exception.resolved_at)}
                    </div>
                  )}
                  {/* Null for anything resolved before the method was recorded. Shown as
                      absent rather than guessed — inventing contact history on an
                      evidence record is worse than admitting the gap. */}
                  {exception.resolution_method && (
                    <div className="text-[11px] font-[500] text-sec">
                      Established: {RESOLUTION_METHOD_LABELS[exception.resolution_method]}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden">
              <SecHead title="Resolve Exception" />
              <form onSubmit={handleResolve} className="p-6 flex flex-col gap-4">
                <Input
                  label="Resolution note"
                  placeholder={COPY.confirm.resolveNote}
                  value={resolutionNote}
                  onChange={e => setResolutionNote(e.target.value)}
                />
                {/* Mandatory, and defaulted to the most common case rather than to a
                    blank. The site visit found this contact happening and going
                    unrecorded; an optional field would have recorded it just as rarely. */}
                <Select
                  label="How was this established?"
                  value={resolutionMethod}
                  onChange={e =>
                    setResolutionMethod(e.target.value as ExceptionResolutionMethod)
                  }
                >
                  {(Object.keys(RESOLUTION_METHOD_LABELS) as ExceptionResolutionMethod[]).map(
                    method => (
                      <option key={method} value={method}>
                        {RESOLUTION_METHOD_LABELS[method]}
                      </option>
                    ),
                  )}
                </Select>
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="success"
                    disabled={!resolutionNote.trim() || resolving}
                    loading={resolving}
                    iconLeft={<Ic n="check" s={14} c="white" />}
                  >
                    {COPY.actions.resolve}
                  </Button>
                </div>
              </form>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
