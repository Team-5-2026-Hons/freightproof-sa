// Exception display formatting.
//
// Module-scoped rather than page-local because two surfaces render the same exception:
// the trip timeline's standalone cards and the in-transit leg's own mini-timeline. When
// this transform lived in the page, the leg had no access to it and printed the raw
// enum — so one exception read two different ways depending on which phase it landed on.

/** "waybill_count_mismatch" -> "Waybill Count Mismatch". */
export function fmtExceptionType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
