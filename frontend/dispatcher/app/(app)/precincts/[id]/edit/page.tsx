'use client'

import React from 'react'
import { useParams } from 'next/navigation'
import { MapPinOff } from 'lucide-react'

import { PrecinctForm } from '@/components/precincts/PrecinctForm'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePrecinctDetail } from '@/lib/hooks/usePrecinctDetail'
import { useAuth } from '@/lib/hooks/useAuth'

export default function EditPrecinctPage(): React.JSX.Element {
  const params = useParams<{ id: string }>()
  const { precinct, isLoading, error } = usePrecinctDetail(params.id)
  const { user } = useAuth()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Spinner size="lg" />
      </div>
    )
  }
  if (error !== null || precinct === null) {
    return (
      <EmptyState
        icon={<MapPinOff />}
        title="Precinct unavailable"
        body={error ?? 'This precinct could not be loaded. It may not exist, or it may belong to another organisation.'}
      />
    )
  }

  const isOwner =
    String(precinct.principal_organization_id) === String(user?.organization_id)

  if (!isOwner) {
    return (
      <EmptyState
        icon={<MapPinOff />}
        title="Precinct not editable"
        body="This precinct belongs to another organisation. It is shared with you for trip planning, so you can view it, but only its owner can change it."
      />
    )
  }

  return <PrecinctForm precinct={precinct} />
}
