'use client'

import React from 'react'
import { useParams } from 'next/navigation'
import { MapPinOff } from 'lucide-react'

import { PrecinctForm } from '@/components/precincts/PrecinctForm'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePrecinctDetail } from '@/lib/hooks/usePrecinctDetail'

export default function EditPrecinctPage(): React.JSX.Element {
  const params = useParams<{ id: string }>()
  const { precinct, isLoading, error } = usePrecinctDetail(params.id)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Spinner size="lg" />
      </div>
    )
  }
  if (error !== null || precinct === null) {
    // A precinct the caller cannot see returns 404, so this covers both "gone" and
    // "not yours" without distinguishing them — which is the point of the 404. The
    // hook collapses every failure to a message string, so the body deliberately does
    // not assert a cause it cannot actually tell apart from a network failure.
    return (
      <EmptyState
        icon={<MapPinOff />}
        title="Precinct unavailable"
        body={error ?? 'This precinct could not be loaded. It may not exist, or it may belong to another organisation.'}
      />
    )
  }

  return <PrecinctForm precinct={precinct} />
}
