// frontend/driver-pwa/lib/utils/render-attestation.ts
//
// Renders the receiver's digital signature as a PNG data URL.
//
// Why a PNG rather than a JSON blob: the POD signature has always travelled as an image
// data URL (SignaturePad exported its canvas), the upload path takes a data URL, and the
// dispatcher's evidence viewer renders the artifact as an image. Emitting the attestation
// in that same shape keeps pod_signature_artifact_id pointing at something every existing
// consumer can already display — which is what keeps this change inside the driver app:
// no backend schema change, no Alembic migration, no dispatcher work.
//
// The image is the human-readable face of the attestation. Its evidential weight comes
// from the artifact hash anchored downstream, not from the pixels.

import { ATTESTATION_CANVAS_COLOURS } from '@/lib/tokens'
import type { DriverPosition } from '@/lib/types/location'

// Canvas geometry. Sized for legibility when a dispute reviewer opens the artifact at
// full width, not for the phone screen it is generated on.
// HEIGHT_PX must clear the last row's value baseline plus bottom padding:
// ROW_START_Y_PX + (rows - 1) * ROW_HEIGHT_PX + LABEL_TO_VALUE_PX + PADDING_PX.
// With the five rows below that is 140 + 296 + 30 + 40 = 506, rounded up.
const WIDTH_PX = 720
const HEIGHT_PX = 520
const PADDING_PX = 40
const RULE_Y_PX = 96

// Type scale. Separate constants rather than inline strings so the block below reads as
// layout rather than as a wall of font shorthand.
const FONT_TITLE = '600 30px system-ui, sans-serif'
const FONT_LABEL = '500 16px system-ui, sans-serif'
const FONT_VALUE = '400 22px system-ui, sans-serif'
const FONT_MONO = '400 18px ui-monospace, monospace'

// Sourced from lib/tokens.ts rather than written inline — hex literals are banned
// outside the token map (DESIGN_SYSTEM.md §2.3). Values and labels share a colour;
// the label's smaller, lighter weight is what sets them apart.
const COLOUR_BACKGROUND = ATTESTATION_CANVAS_COLOURS.background
const COLOUR_TITLE = ATTESTATION_CANVAS_COLOURS.title
const COLOUR_LABEL = ATTESTATION_CANVAS_COLOURS.label
const COLOUR_VALUE = ATTESTATION_CANVAS_COLOURS.title
const COLOUR_RULE = ATTESTATION_CANVAS_COLOURS.rule

// Vertical rhythm: where each label/value pair starts, and the gap between the label and
// the value beneath it.
const ROW_START_Y_PX = 140
const ROW_HEIGHT_PX = 74
const LABEL_TO_VALUE_PX = 30

// ~0.1 m of precision. More digits would imply an accuracy no consumer handset delivers.
const COORD_DECIMALS = 6

const TITLE = 'DIGITAL PROOF OF DELIVERY'
const LOCATION_UNAVAILABLE = 'Location unavailable'

export interface AttestationFields {
  /** ISO 8601 instant the receiver completed the swipe. */
  signedAt: string
  /** Fix taken at the moment of signing, or null when the phone could not produce one. */
  position: DriverPosition | null
  /** The trip this delivery closes — ties the image to a record if it is ever exported. */
  tripId: string
}

/**
 * Format the fix for display, or explain its absence.
 *
 * A missing position is rendered as an explicit "Location unavailable" line rather than
 * being omitted: a reviewer must be able to tell "the phone had no fix" apart from "this
 * attestation predates location capture", and a blank row says neither.
 */
export function formatPosition(position: DriverPosition | null): string {
  if (position === null) return LOCATION_UNAVAILABLE

  const lat = position.lat.toFixed(COORD_DECIMALS)
  const lng = position.lng.toFixed(COORD_DECIMALS)
  // accuracyM is null when the platform reports no uncertainty — show the coordinates
  // without inventing a confidence figure for them.
  if (position.accuracyM === null) return `${lat}, ${lng}`
  return `${lat}, ${lng}  (±${Math.round(position.accuracyM)} m)`
}

/**
 * Render both a device-local rendering of the instant and the ISO 8601 form.
 *
 * Both, not either: the local string is what a human reading the artifact expects to see,
 * and the ISO string is the unambiguous one that survives being read in another timezone.
 * Deliberately no hardcoded SAST — the device's own zone is the honest answer to "where
 * was this signed", and the ISO line removes the ambiguity that creates.
 */
export function formatSignedAt(signedAt: string): { local: string; iso: string } {
  const date = new Date(signedAt)
  return { local: date.toLocaleString(), iso: date.toISOString() }
}

/**
 * Draw the attestation and return it as a PNG data URL.
 *
 * Returns null when the 2D context is unavailable (jsdom, or a browser that refuses the
 * context under memory pressure). Callers must treat null as "could not sign" and keep
 * the receiver on the step — silently returning a blank image would put an empty artifact
 * into the evidence chain, which is worse than failing loudly.
 */
export function renderAttestation(fields: AttestationFields): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH_PX
  canvas.height = HEIGHT_PX

  const ctx = canvas.getContext('2d')
  if (ctx === null) return null

  ctx.fillStyle = COLOUR_BACKGROUND
  ctx.fillRect(0, 0, WIDTH_PX, HEIGHT_PX)

  ctx.fillStyle = COLOUR_TITLE
  ctx.font = FONT_TITLE
  ctx.fillText(TITLE, PADDING_PX, PADDING_PX + 30)

  ctx.strokeStyle = COLOUR_RULE
  ctx.beginPath()
  ctx.moveTo(PADDING_PX, RULE_Y_PX)
  ctx.lineTo(WIDTH_PX - PADDING_PX, RULE_Y_PX)
  ctx.stroke()

  const { local, iso } = formatSignedAt(fields.signedAt)
  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: 'SIGNED BY', value: 'Receiver, on the driver’s device' },
    { label: 'SIGNED AT', value: local },
    { label: 'UTC', value: iso, mono: true },
    { label: 'LOCATION', value: formatPosition(fields.position), mono: true },
    { label: 'TRIP', value: fields.tripId, mono: true },
  ]

  rows.forEach((row, index) => {
    const y = ROW_START_Y_PX + index * ROW_HEIGHT_PX

    ctx.fillStyle = COLOUR_LABEL
    ctx.font = FONT_LABEL
    ctx.fillText(row.label, PADDING_PX, y)

    ctx.fillStyle = COLOUR_VALUE
    ctx.font = row.mono === true ? FONT_MONO : FONT_VALUE
    ctx.fillText(row.value, PADDING_PX, y + LABEL_TO_VALUE_PX)
  })

  return canvas.toDataURL('image/png')
}
