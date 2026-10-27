// UI-side draft shapes (base64 data URLs, not artifact ids yet) for each phase's
// evidence, keyed by phase type — lib/api/phases.ts converts each to its wire variant.
// UnloadingEvidence.driverVisualCount and ConfirmationEvidence.driverVisualCount are two
// different fields on two different phase drafts, bridged by a durable carry-forward
// mechanism, lib/hooks/useVisualCountCarry.ts (wired in PhaseStepPageClient.tsx).

import type { SealCondition } from '@shared/lib/types/phase'

export interface ActivationEvidence {
  capturedAt: string | null
}

export interface LoadingEvidence {
  linehaulPhotoDataUrl: string | null
  linehaulPhotoArtifactId: string | null
  linehaulPdfDataUrl?: string | null
  linehaulPdfArtifactId?: string | null
  capturedAt: string | null
}

export interface DepartureEvidence {
  sealNumber: string | null
  sealNumberOcr?: string | null
  sealPhotoDataUrl: string | null
  sealPhotoArtifactId: string | null
  capturedAt: string | null
}

export interface UnloadingEvidence {
  waybillHandedOver: boolean | null
  driverVisualCount: number | null
  capturedAt: string | null
}

export interface ArrivalEvidence {
  sealCondition: SealCondition | null
  sealNumberAtArrival: string | null
  sealNumberAtArrivalOcr?: string | null
  sealPhotoDataUrl: string | null
  sealPhotoArtifactId: string | null
  capturedAt: string | null
}

export interface ConfirmationEvidence {
  podPhotoDataUrl: string | null
  podPhotoArtifactId: string | null
  podSignatureArtifactId: string | null
  receiverConfirmedAt: string | null

  driverVisualCount: number | null
  reconciliationNote: string | null
  capturedAt: string | null
}

export interface InTransitEvidence {
  capturedAt: string | null
}

export type PhaseEvidence =
  | ActivationEvidence
  | LoadingEvidence
  | DepartureEvidence
  | InTransitEvidence
  | ArrivalEvidence
  | UnloadingEvidence
  | ConfirmationEvidence
