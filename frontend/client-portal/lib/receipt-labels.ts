// What each kind of Hedera receipt commits to, in words a claims handler uses rather than the
// system's own names. Keys are the backend BlockchainReceiptType values (app/db/models/enums.py);
// the PDF prints the same phrases from RECEIPT_LABELS in app/reporting/pdf_renderer.py.
import { humanise } from './format'

const RECEIPT_LABELS: Record<string, string> = {
  journey_lock: 'Trip plan locked when the trip was created',
  activation: 'Driver started the trip',
  loading: 'Loading completed',
  pickup: 'Departure handover: seal and waybill',
  transit_arrival: 'Arrival at a stop',
  arrival_inspection: 'Arrival inspection of the seal',
  unloading: 'Unloading completed',
  delivery: 'Delivery confirmed',
  phase_override: 'Dispatcher override of a phase',
  checkpoint_batch: 'Checkpoints on the road',
  exception_batch: 'Exceptions raised',
  exception_raised: 'Exception reported',
  exception_reviewed: 'Exception reviewed by a dispatcher',
  trip_cancelled: 'Trip cancelled',
  driver_substitution: 'Driver handover',
  driver_substitution_corrected: 'Correction to a driver handover',
  vehicle_created: 'Vehicle record created',
  vehicle_updated: 'Vehicle record changed',
  driver_created: 'Driver record created',
  driver_updated: 'Driver record changed',
  precinct_created: 'Depot boundary created',
  precinct_updated: 'Depot boundary changed',
  audit_pack_issued: "This pack's seal",
}

/** A plain name for a receipt; a type added after this list falls back to the system's own wording, never a blank. */
export function receiptLabel(receiptType: string, subjectType: string): string {
  return RECEIPT_LABELS[receiptType] ?? `${humanise(receiptType)} · ${humanise(subjectType)}`
}
