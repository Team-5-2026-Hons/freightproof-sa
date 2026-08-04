// frontend/driver-pwa/components/phase/sealsMatch.ts
//
// Moved out of the retired components/handshake/steps/H3ExitSeal.tsx (old gate-out
// confirmation step) rather than deleted with it. Under the phase model both ends of a
// seal comparison can live in different components — departure/CaptureSeal.tsx compares
// the guard's confirmation against the seal just captured in the SAME draft, and
// unloading/SealVerify.tsx compares the destination entry against a reference carried
// forward from departure (via lib/hooks/useSealReference.ts, wired by a later task) — so
// this needs to be a shared, standalone helper rather than living inside either step.
//
// Case-insensitive, whitespace-tolerant comparison. Both callers use this SAME function
// for their live indicator and their persisted sealVerifiedMatch value, so the two can
// never drift out of sync — the bug class a prior review caught (commit c1a8c2b) when
// they were computed separately. A null/empty reference never matches.
export function sealsMatch(a: string, b: string | null): boolean {
  const normalizedA = a.trim().toUpperCase()
  const normalizedB = (b ?? '').trim().toUpperCase()
  return normalizedA.length > 0 && normalizedA === normalizedB
}
