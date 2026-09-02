// Blockchain receipt types for FreightProof SA.
// Mirrors backend/app/schemas/blockchain.py — all subjects, receipt types,
// and verify result shapes live here so dispatcher and driver-pwa stay in sync.

export type SubjectType =
  | 'trip' | 'vehicle' | 'driver' | 'vehicle_event' | 'driver_event'
  | 'precinct_event';

export type BlockchainReceiptType =
  | 'journey_lock' | 'pickup' | 'delivery' | 'checkpoint_batch'
  | 'exception_batch' | 'driver_substitution'
  | 'vehicle_created' | 'vehicle_updated'
  | 'driver_created' | 'driver_updated'
  | 'precinct_created' | 'precinct_updated';

export type BlockchainReceipt = {
  id: string;
  subject_type: SubjectType;
  subject_id: string;
  receipt_type: BlockchainReceiptType;
  data_hash: string;
  hedera_topic_id: string | null;
  hedera_sequence_number: number | null;
  hedera_consensus_timestamp: string | null;
  hedera_tx_id: string | null;
  created_at: string;
};

export type VerifyStatus =
  | 'verified' | 'db_mismatch' | 'hedera_mismatch' | 'no_receipt' | 'error';

export type VerifyResult = {
  status: VerifyStatus;
  receipt: BlockchainReceipt | null;
  expected_hash: string | null;
  current_hash: string | null;
};

// Mirrors VehicleEventType enum in backend/app/db/models/enums.py exactly.
export type VehicleEventType =
  | 'created' | 'license_plate_changed' | 'license_disc_renewed'
  | 'vin_updated' | 'vehicle_updated' | 'deactivated' | 'cosmetic_update';

export type DriverEventType =
  | 'created' | 'license_renewed' | 'deactivated' | 'cosmetic_update';

export type VehicleEvent = {
  id: string;
  vehicle_id: string;
  event_type: VehicleEventType;
  // Arbitrary field-level diff captured at mutation time — shape varies per event type.
  changed_fields: Record<string, unknown>;
  changed_by_user_id: string;
  blockchain_receipt_id: string | null;
  created_at: string;
};

export type DriverEvent = {
  id: string;
  driver_id: string;
  event_type: DriverEventType;
  // Arbitrary field-level diff captured at mutation time — shape varies per event type.
  changed_fields: Record<string, unknown>;
  changed_by_user_id: string;
  blockchain_receipt_id: string | null;
  created_at: string;
};

// Mirrors PrecinctEventType in backend/app/db/models/enums.py exactly.
// A relocation and a resize are separate types because they mean different things
// evidentially: one changes where the facility is, the other changes how close a
// handshake must be to count as inside it.
export type PrecinctEventType =
  | 'created' | 'relocated' | 'geofence_resized'
  | 'sharing_changed' | 'cosmetic_update';

export type PrecinctEvent = {
  id: string;
  precinct_id: string;
  event_type: PrecinctEventType;
  // {field: {from, to}} for updates; a flat snapshot for 'created'.
  changed_fields: Record<string, unknown>;
  changed_by_user_id: string;
  // Null for cosmetic edits, which are logged but never anchored. The absence is
  // information — it is why no anchor badge renders on that row.
  blockchain_receipt_id: string | null;
  created_at: string;
};
