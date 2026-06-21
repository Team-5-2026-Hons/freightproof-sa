// Pure helper: turns a vehicle/driver event's `changed_fields` JSONB payload into
// friendly, renderable rows for the forensic-only detail view.
//
// `changed_fields` shape varies by event type (see backend/app/orchestration/
// vehicle_service.py, driver_service.py, and backend/app/blockchain/critical_fields.py):
//   1. CREATED events       -> flat snapshot dict: { field: primitiveValue }
//   2. critical-field UPDATE -> diff dict: { field: { from: old, to: new } }
//   3. cosmetic UPDATE       -> meta dict: { _no_critical_change: true, _patch: {...} }
//
// This module is a pure data transform with no React/DOM dependency so it can be
// reasoned about (and unit tested) in isolation.

export type ChangeRow = {
  label: string
  value: string
}

// Friendly labels for known field keys (vehicle + driver critical/snapshot fields).
const FIELD_LABELS: Record<string, string> = {
  registration: 'Registration',
  vehicle_type: 'Vehicle type',
  pulsit_device_id: 'GPS device ID',
  make: 'Make',
  model: 'Model',
  year: 'Year',
  vin_number: 'VIN',
  licence_disc_expiry: 'Licence disc expiry',
  is_active: 'Active',
  license_expiry: 'Licence expiry',
  license_number_sha256: 'Licence number',
}

// Keys that are bookkeeping/meta, never real changed-field values.
const META_KEYS = new Set(['_no_critical_change', '_patch'])

// Keys whose value is a hash, not a human-meaningful value — never render the raw hash.
const HASH_ONLY_KEYS = new Set(['license_number_sha256'])

function humanizeKey(key: string): string {
  return key
    .replace(/^_/, '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? humanizeKey(key)
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'Active' : 'Inactive'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  // Defensive fallback for anything unexpected (arrays, nested objects, etc).
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isFromToShape(value: unknown): value is { from: unknown; to: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'from' in (value as Record<string, unknown>) &&
    'to' in (value as Record<string, unknown>)
  )
}

/**
 * Maps a vehicle/driver event's `changed_fields` payload to friendly rows for
 * display inside ForensicOnly. Handles flat snapshots, {from,to} diffs, and the
 * cosmetic-update meta shape. Never renders a raw hash as if it were readable PII.
 */
export function describeChange(changedFields: Record<string, unknown>): ChangeRow[] {
  if (!changedFields || typeof changedFields !== 'object') return []

  // Cosmetic update: { _no_critical_change: true, _patch: {...} }.
  // These are meta keys, not named critical fields — summarize, don't iterate _patch.
  if (changedFields._no_critical_change === true) {
    return [{ label: 'Change type', value: 'Cosmetic (non-critical fields updated)' }]
  }

  const rows: ChangeRow[] = []

  for (const [key, value] of Object.entries(changedFields)) {
    if (META_KEYS.has(key)) continue

    // license_number_sha256 (and any future hash-only key): never show hash-to-hash,
    // it conveys nothing meaningful even though it isn't PII itself.
    if (HASH_ONLY_KEYS.has(key)) {
      rows.push({ label: labelFor(key), value: 'Updated' })
      continue
    }

    if (isFromToShape(value)) {
      const from = formatPrimitive(value.from)
      const to = formatPrimitive(value.to)
      rows.push({ label: labelFor(key), value: `${from} → ${to}` })
      continue
    }

    rows.push({ label: labelFor(key), value: formatPrimitive(value) })
  }

  return rows
}
