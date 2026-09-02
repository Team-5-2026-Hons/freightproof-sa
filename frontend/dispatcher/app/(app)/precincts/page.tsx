'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { TopBar } from '@/components/ui/TopBar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { AdminOnly } from '@/components/auth/AdminOnly'
import { PrecinctCard } from '@/components/precincts/PrecinctCard'
import { useAuth } from '@/lib/hooks/useAuth'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { useToast } from '@/lib/hooks/useToast'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@shared/lib/utils/cn'
import type { Precinct } from '@shared/lib/types/precinct'

type OwnerFilter = 'all' | 'mine' | 'shared'

export default function PrecinctsPage(): React.JSX.Element {
  const router = useRouter()
  const { precincts, isLoading, error: fetchError, refetch } = usePrecincts()
  const { user } = useAuth()
  const { notify } = useToast()

  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (fetchError) {
      notify({ kind: 'error', title: 'Failed to load precincts', body: fetchError })
    }
  }, [fetchError, notify])

  // Ownership drives what a dispatcher can do with a row, so it is worth showing
  // rather than leaving them to discover it from a 404.
  // useCallback so the memo below can depend on isOwned by identity rather than on the
  // `user` it closes over — same behaviour, but the dependency is one the linter can see.
  const isOwned = useCallback(
    (precinct: Precinct): boolean =>
      String(precinct.principal_organization_id) === String(user?.organization_id),
    [user],
  )

  const mineCount = precincts.filter(isOwned).length
  const sharedCount = precincts.length - mineCount

  const visible = useMemo(() => {
    const byOwner = precincts.filter((p) => {
      if (ownerFilter === 'mine') return isOwned(p)
      if (ownerFilter === 'shared') return !isOwned(p)
      return true
    })
    const query = search.trim().toLowerCase()
    if (query.length === 0) return byOwner
    return byOwner.filter((p) =>
      [p.name, p.address].filter(Boolean).some((f) => f!.toLowerCase().includes(query)),
    )
  }, [precincts, ownerFilter, search, isOwned])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Precincts">
        <AdminOnly>
          <Button
            size="sm"
            iconLeft={<Plus className="w-4 h-4" />}
            onClick={() => router.push(ROUTES.precinctNew)}
          >
            Add Precinct
          </Button>
        </AdminOnly>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-[2px] bg-surf-low rounded-md p-[3px] shrink-0">
            {([
              { id: 'all', label: `All (${precincts.length})` },
              { id: 'mine', label: `Mine (${mineCount})` },
              { id: 'shared', label: `Shared (${sharedCount})` },
            ] as { id: OwnerFilter; label: string }[]).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setOwnerFilter(opt.id)}
                className={cn(
                  'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase transition-colors',
                  ownerFilter === opt.id
                    ? 'bg-surf-lowest text-on-surf shadow-level-1'
                    : 'text-on-surf-v hover:text-on-surf',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[140px]">
            <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
            <input
              type="text"
              placeholder="Name or address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-4 py-2 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf placeholder:text-on-surf-v/60 outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : fetchError ? (
          <EmptyState
            icon={<AlertCircle />}
            title="Failed to load"
            body={fetchError}
            cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>}
          />
        ) : precincts.length === 0 ? (
          <EmptyState
            icon={<Ic n="map" s={32} />}
            title="No precincts"
            body="No depots or warehouses mapped yet."
            cta={
              <AdminOnly>
                <Button size="sm" onClick={() => router.push(ROUTES.precinctNew)}>
                  Add the first precinct
                </Button>
              </AdminOnly>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Ic n="search" s={32} />}
            title="No matches"
            body="No precincts match your filters."
            cta={
              <Button size="sm" variant="ghost" onClick={() => { setOwnerFilter('all'); setSearch('') }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {visible.map((p) => (
                <PrecinctCard
                  key={p.id}
                  precinct={p}
                  isOwned={isOwned(p)}
                  onClick={() => router.push(ROUTES.precinctDetail(p.id))}
                />
              ))}
            </div>

            <p className="text-[10px] text-on-surf-v text-center">
              {/* Required by OpenStreetMap's tile usage policy — not a nicety, a licence condition. */}
              © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline hover:text-on-surf">OpenStreetMap</a> contributors
            </p>
          </>
        )}
      </div>
    </div>
  )
}
