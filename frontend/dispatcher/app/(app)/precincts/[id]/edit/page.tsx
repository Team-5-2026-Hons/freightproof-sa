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

  // GET /precincts/{id} deliberately returns precincts shared by OTHER organisations,
  // so a precinct loading here is not evidence the caller may write to it — PATCH answers
  // 404 for anything its org does not own. The detail page already hides Edit for these;
  // this covers arriving at the URL directly, which otherwise renders a fully populated
  // form whose only possible outcome is a 404 on save. The server remains the control.
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
