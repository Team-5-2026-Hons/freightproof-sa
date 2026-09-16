// Renders the receiver's digital signature as a PNG data URL — matches the shape the
// upload path and dispatcher's evidence viewer already expect. Shared because both
// driver-pwa and receiver draw the same artifact and must not drift into two different
// images for one evidence type. Evidential weight comes from the artifact hash anchored
// downstream, not the pixels.

import { ATTESTATION_CANVAS_COLOURS } from '@shared/lib/constants/attestation-colours'
import type { PositionFix } from '@shared/lib/types/position'

// Canvas geometry, sized for a full-width dispute review, not the phone screen it's
// generated on. HEIGHT_PX must clear the last row: ROW_START_Y_PX + (rows - 1) *
// ROW_HEIGHT_PX + LABEL_TO_VALUE_PX + PADDING_PX = 160 + 370 + 30 + 40 = 600.
const WIDTH_PX = 720
const HEIGHT_PX = 600
const PADDING_PX = 40
const RULE_Y_PX = 116

// Widest a value may draw before ellipsizing, so a long free-typed name doesn't run off
// the canvas and silently lose the end of the identity it exists to record.
const MAX_VALUE_WIDTH_PX = WIDTH_PX - PADDING_PX * 2
const ELLIPSIS = '…'

const FONT_TITLE = '600 30px system-ui, sans-serif'
const FONT_LABEL = '500 16px system-ui, sans-serif'
const FONT_VALUE = '400 22px system-ui, sans-serif'
const FONT_MONO = '400 18px ui-monospace, monospace'

// Sourced from lib/tokens.ts — hex literals are banned outside the token map
// (DESIGN_SYSTEM.md §2.3).
const COLOUR_BACKGROUND = ATTESTATION_CANVAS_COLOURS.background
const COLOUR_TITLE = ATTESTATION_CANVAS_COLOURS.title
const COLOUR_LABEL = ATTESTATION_CANVAS_COLOURS.label
const COLOUR_VALUE = ATTESTATION_CANVAS_COLOURS.title
const COLOUR_RULE = ATTESTATION_CANVAS_COLOURS.rule

const ROW_START_Y_PX = 160
const ROW_HEIGHT_PX = 74
const LABEL_TO_VALUE_PX = 30

// ~0.1 m of precision. More digits would imply an accuracy no consumer handset delivers.
const COORD_DECIMALS = 6

const TITLE = 'DIGITAL PROOF OF DELIVERY'
const SUBTITLE = 'Swipe attestation taken on the driver’s device'
const LOCATION_UNAVAILABLE = 'Location unavailable'

export interface AttestationFields {
  /** ISO 8601 instant the receiver completed the swipe. */
  signedAt: string
  /** Fix taken at the moment of signing, or null when the phone could not produce one. */
  position: PositionFix | null
  /** The trip this delivery closes — ties the image to a record if it is ever exported. */
  tripId: string
  /** Non-empty by the time this runs — the signing swipe won't arm without it. */
  recipientName: string
  /**
   * The receiver's ID number, as presented, unvalidated beyond a shape hint (lib/utils/sa-id.ts).
   * POPIA: personal data. Stays in this image artifact only — must never reach a
   * phase-completion request, canonical payload, or anything anchored to Hedera.
   */
  recipientIdNumber: string
}

/**
 * Ellipsize `value` to fit `maxWidthPx` under the font currently set on `ctx`.
 * Trims one character at a time rather than estimating from an average glyph width, since
 * only the canvas knows how wide the device's system-ui actually renders.
 */
export function fitText(ctx: CanvasRenderingContext2D, value: string, maxWidthPx: number): string {
  if (ctx.measureText(value).width <= maxWidthPx) return value

  let truncated = value
  while (truncated.length > 0 && ctx.measureText(truncated + ELLIPSIS).width > maxWidthPx) {
    truncated = truncated.slice(0, -1)
  }
  return truncated + ELLIPSIS
}

/**
 * Format the fix for display, or explain its absence.
 * Renders "Location unavailable" explicitly rather than omitting the row, so a reviewer
 * can tell "no fix" apart from "predates location capture".
 */
export function formatPosition(position: PositionFix | null): string {
  if (position === null) return LOCATION_UNAVAILABLE

  const lat = position.lat.toFixed(COORD_DECIMALS)
  const lng = position.lng.toFixed(COORD_DECIMALS)
  // accuracyM is null when the platform reports no uncertainty.
  if (position.accuracyM === null) return `${lat}, ${lng}`
  return `${lat}, ${lng}  (±${Math.round(position.accuracyM)} m)`
}

/**
 * Render both a device-local rendering of the instant and the ISO 8601 form: the local
 * string reads naturally, the ISO string survives being read in another timezone.
 * Deliberately no hardcoded SAST — the device's own zone is the honest answer.
 */
export function formatSignedAt(signedAt: string): { local: string; iso: string } {
  const date = new Date(signedAt)
  return { local: date.toLocaleString(), iso: date.toISOString() }
}

/**
 * Draw the attestation and return it as a PNG data URL.
 * Returns null when the 2D context is unavailable (jsdom, or memory pressure). Callers
 * must treat null as "could not sign" — a blank image in the evidence chain is worse.
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

  ctx.fillStyle = COLOUR_LABEL
  ctx.font = FONT_LABEL
  ctx.fillText(SUBTITLE, PADDING_PX, PADDING_PX + 54)

  ctx.strokeStyle = COLOUR_RULE
  ctx.beginPath()
  ctx.moveTo(PADDING_PX, RULE_Y_PX)
  ctx.lineTo(WIDTH_PX - PADDING_PX, RULE_Y_PX)
  ctx.stroke()

  const { local, iso } = formatSignedAt(fields.signedAt)
  // Identity first — the question a disputed delivery asks is "who signed it".
  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: 'SIGNED BY', value: fields.recipientName },
    { label: 'ID NUMBER', value: fields.recipientIdNumber, mono: true },
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
    // Font is set BEFORE fitText measures — measureText reports against whatever font is
    // currently on the context, so measuring first would size against the label's font.
    ctx.font = row.mono === true ? FONT_MONO : FONT_VALUE
    ctx.fillText(fitText(ctx, row.value, MAX_VALUE_WIDTH_PX), PADDING_PX, y + LABEL_TO_VALUE_PX)
  })

  return canvas.toDataURL('image/png')
}
