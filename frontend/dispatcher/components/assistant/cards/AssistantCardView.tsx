'use client'

import type { AssistantCard, RecordRef } from '@shared/lib/types/assistant'
import { BookingsCardView, ChooseCardView, FreeCrewCardView, HistoryCardView } from './CrewCards'
import { FormPreviewCardView } from './FormPreviewCard'
import { ExpiryListCardView, ParcelCardView, RosterCardView, RouteTimeCardView, VehicleCardView } from './FleetCards'
import { IncidentListCardView, ReviewQueueCardView, TripCardView, TripListCardView } from './TripCards'
import type { NavigateTo } from '../navigation'

interface AssistantCardViewProps {
  card: AssistantCard
  onNavigate: NavigateTo
  onChoose: (record: RecordRef) => void
  busy: boolean
}

/** One card under an answer: the records the server loaded, never the model's words (spec D3). */
export function AssistantCardView({ card, onNavigate, onChoose, busy }: AssistantCardViewProps) {
  switch (card.type) {
    case 'trip_list': return <TripListCardView card={card} onNavigate={onNavigate} />
    case 'trip': return <TripCardView card={card} onNavigate={onNavigate} />
    case 'incident_list': return <IncidentListCardView card={card} onNavigate={onNavigate} />
    case 'review_queue': return <ReviewQueueCardView card={card} onNavigate={onNavigate} />
    case 'bookings': return <BookingsCardView card={card} onNavigate={onNavigate} />
    case 'choose': return <ChooseCardView card={card} onChoose={onChoose} disabled={busy} />
    case 'vehicle': return <VehicleCardView card={card} onNavigate={onNavigate} />
    case 'expiry_list': return <ExpiryListCardView card={card} onNavigate={onNavigate} />
    case 'free_crew': return <FreeCrewCardView card={card} onNavigate={onNavigate} />
    case 'route_time': return <RouteTimeCardView card={card} onNavigate={onNavigate} />
    case 'parcel': return <ParcelCardView card={card} onNavigate={onNavigate} />
    case 'history': return <HistoryCardView card={card} onNavigate={onNavigate} />
    case 'roster': return <RosterCardView card={card} onNavigate={onNavigate} />
    case 'form_preview': return <FormPreviewCardView card={card} onNavigate={onNavigate} />
  }
}
