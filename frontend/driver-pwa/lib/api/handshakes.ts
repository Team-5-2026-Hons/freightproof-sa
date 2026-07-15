// frontend/driver-pwa/lib/api/handshakes.ts
import type { HandshakeType } from '@shared/lib/types/handshake'
import type { Trip } from '@shared/lib/types/trip'
import type {
  H1Evidence, H2Evidence, H3Evidence, H4Evidence, H5Evidence, HandshakeEvidence,
} from '@/lib/types/evidence-draft'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { uploadArtifact } from './artifacts'
import { completeH1, completeH2, completeH3, completeH4, completeH5 } from './trips'

export interface SubmitHandshakeResult {
  ok: boolean
  eventHash: string
  // The backend's updated TripDetail from the complete call. The submit flow needs it
  // to decide the anchored/anchoring receipt copy: after H5 the trip is CLOSED, so a
  // refetch of /trips/me/active returns null and can't confirm the anchor — this
  // response body is the only trip that still carries the H5 receipt id. Null in demo
  // mode (no backend call happened).
  trip: Trip | null
}

// Demo mode: IS_DEMO_MODE (NEXT_PUBLIC_DEMO_MODE=true/unset) returns a mock success immediately.
// Production: uploads any captured photos as evidence artifacts, then calls the matching
// /trips/{id}/handshakes/h{n}/complete endpoint with the resulting artifact IDs. The
// signature (tripId, handshakeType, evidence) stays unchanged so useOfflineQueue's
// retry path (which calls this same function) keeps working without modification.
export async function submitHandshake(
  tripId: string,
  handshakeType: HandshakeType,
  evidence: HandshakeEvidence,
): Promise<SubmitHandshakeResult> {
  if (IS_DEMO_MODE) {
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    return { ok: true, eventHash: crypto.randomUUID(), trip: null }
  }

  const capturedAt = (evidence as { capturedAt?: string | null }).capturedAt ?? new Date().toISOString()

  let updatedTrip: Trip

  switch (handshakeType) {
    case 'origin_gate_in': {
      const e = evidence as H1Evidence
      if (e.gpsLat === null || e.gpsLng === null || e.gatePhotoDataUrl === null) {
        throw new Error('H1 evidence incomplete — GPS and gate photo are required.')
      }
      const photo = await uploadArtifact({
        tripId, artifactType: 'photo', dataUrl: e.gatePhotoDataUrl,
        capturedAt, capturedLat: e.gpsLat, capturedLng: e.gpsLng,
      })
      updatedTrip = await completeH1(tripId, {
        driver_phone_lat: e.gpsLat, driver_phone_lng: e.gpsLng, gate_photo_artifact_id: photo.id,
      })
      break
    }
    case 'loading': {
      const e = evidence as H2Evidence
      if (e.waybillPhotoDataUrl === null || e.sealPhotoDataUrl === null || e.sealNumber === null || e.driverVisualCount === null) {
        throw new Error('H2 evidence incomplete — waybill photo, seal photo/number, and visual count are required.')
      }
      const [waybillPhoto, sealPhoto] = await Promise.all([
        uploadArtifact({ tripId, artifactType: 'photo', dataUrl: e.waybillPhotoDataUrl, capturedAt }),
        uploadArtifact({ tripId, artifactType: 'photo', dataUrl: e.sealPhotoDataUrl, capturedAt }),
      ])
      updatedTrip = await completeH2(tripId, {
        waybill_photo_artifact_id: waybillPhoto.id, seal_number: e.sealNumber,
        seal_photo_artifact_id: sealPhoto.id, driver_visual_count: e.driverVisualCount,
      })
      break
    }
    case 'origin_gate_out': {
      const e = evidence as H3Evidence
      if (e.gatePhotoDataUrl === null) {
        throw new Error('H3 evidence incomplete — exit gate photo is required.')
      }
      const photo = await uploadArtifact({ tripId, artifactType: 'photo', dataUrl: e.gatePhotoDataUrl, capturedAt })
      updatedTrip = await completeH3(tripId, {
        gate_exit_photo_artifact_id: photo.id,
        // The boolean is only a fallback: the server compares seal_number_confirmed
        // against H2's committed seal (authoritative) whenever it's present. sealVerifiedMatch
        // is computed against a device-local seal reference (useSealReference) that can be
        // lost — reinstall, cleared storage — in which case `e.sealVerifiedMatch ?? false`
        // used to send a false "guard did not verify" even though the driver DID confirm a
        // seal. Sending `=== true` only claims verification when it was actually computed.
        guard_verified_seal: e.sealVerifiedMatch === true,
        seal_number_confirmed: e.sealNumberConfirmed?.trim() ? e.sealNumberConfirmed.trim() : undefined,
      })
      break
    }
    case 'dest_gate_in': {
      const e = evidence as H4Evidence
      if (e.gatePhotoDataUrl === null || e.sealNumberAtDestination === null) {
        throw new Error('H4 evidence incomplete — entry photo and seal number are required.')
      }
      const photo = await uploadArtifact({ tripId, artifactType: 'photo', dataUrl: e.gatePhotoDataUrl, capturedAt })
      updatedTrip = await completeH4(tripId, {
        gate_entry_photo_artifact_id: photo.id, seal_number_at_destination: e.sealNumberAtDestination,
      })
      break
    }
    case 'unloading': {
      const e = evidence as H5Evidence
      if (e.driverVisualCount === null || e.podPhotoDataUrl === null || !e.podSignatureDataUrl) {
        throw new Error('H5 evidence incomplete — visual count, POD photo, and signature are all required.')
      }
      const [podPhoto, podSignature] = await Promise.all([
        uploadArtifact({ tripId, artifactType: 'photo', dataUrl: e.podPhotoDataUrl, capturedAt }),
        uploadArtifact({ tripId, artifactType: 'document', dataUrl: e.podSignatureDataUrl, capturedAt }),
      ])
      updatedTrip = await completeH5(tripId, {
        pod_photo_artifact_id: podPhoto.id,
        pod_signature_artifact_id: podSignature.id,
        driver_visual_count: e.driverVisualCount,
        // pp_scan_in_count isn't captured anywhere in the driver UI (it's the Parcel
        // Perfect scan-in count, not a driver-entered value) — Parcel Perfect integration
        // is out of scope for now, so the driver's own visual count is used as a stand-in.
        // This means that leg of H5's 3-way reconciliation can never independently catch
        // a mismatch until a real PP integration lands. Flagged, not hidden.
        pp_scan_in_count: e.driverVisualCount,
      })
      break
    }
    default:
      throw new Error(`submitHandshake: unhandled handshake type "${handshakeType}"`)
  }

  return { ok: true, eventHash: '', trip: updatedTrip }
}
