'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { IncidentDetailView } from '@/components/incidents/IncidentDetailView'
import { ROUTES } from '@/lib/constants/routes'
import { RETURN_TO_PARAM, safeReturnTo } from '@/lib/navigation/returnTo'

export default function IncidentDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const search = useSearchParams()
  const backHref = safeReturnTo(search.get(RETURN_TO_PARAM), ROUTES.incidents)
  return <IncidentDetailView incidentId={params.id} backHref={backHref} onNavigate={href => router.push(href)} />
}
