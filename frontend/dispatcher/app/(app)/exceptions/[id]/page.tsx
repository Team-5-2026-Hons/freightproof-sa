'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TopBar }     from '@/components/ui/TopBar'
import { SecHead }    from '@/components/ui/SecHead'
import { Chip }       from '@/components/ui/Chip'
import { Button }     from '@/components/ui/Button'
import { Ic }         from '@/components/ui/Ic'
import { Input }      from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { TripIdStamp } from '@/components/domain/TripIdStamp'
import { useToast }      from '@/lib/hooks/useToast'
import { useExceptions } from '@/lib/hooks/useExceptions'
import { mockTrips }     from '@shared/lib/mocks/trips'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META } from '@shared/lib/constants/status-meta'
import { COPY }   from '@shared/lib/constants/copy'
import { ROUTES } from '@/lib/constants/routes'

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

  const exceptionId  = params.id as string
  const allExceptions = useExceptions()
  const exception = useMemo(
    () => allExceptions.find(e => e.id === exceptionId),
    [allExceptions, exceptionId],
  )

  const [resolutionNote, setResolutionNote] = useState('')
  const [resolving, setResolving]           = useState(false)

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

  const trip    = mockTrips.find(t => t.id === exception.trip_id)
  const sevMeta = EXCEPTION_SEVERITY_META[exception.severity]
  const srcMeta = EXCEPTION_SOURCE_META[exception.source]

  const handleResolve = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!resolutionNote.trim()) return
    setResolving(true)
    await new Promise(r => setTimeout(r, 600))
    notify({ kind: 'success', title: COPY.toast.exceptionResolved })
    router.push(ROUTES.exceptions)
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
          {trip && (
            <div className="bg-surf-low rounded-lg px-5 py-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-1">
                  Related Trip
                </div>
                <TripIdStamp tripReference={trip.trip_reference} />
              </div>
              <button
                onClick={() => router.push(ROUTES.tripDetail(trip.id))}
                className="flex items-center gap-1 text-[13px] font-[600] text-sec hover:opacity-75 transition-opacity"
              >
                View trip <Ic n="chev" s={14} c="#0051d5" />
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
                {exception.resolved_at && (
                  <div className="flex items-center gap-1.5 text-[11px] font-[500] text-sec tabular-nums">
                    <Ic n="clock" s={10} className="text-sec shrink-0" />
                    {fmtTs(exception.resolved_at)}
                  </div>
                )}
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
