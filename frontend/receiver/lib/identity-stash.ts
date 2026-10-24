// Everything the receiver app keeps in sessionStorage, in one place so the handover page
// and the mock vendor page cannot drift apart on key or shape.
//
// sessionStorage, not localStorage: it dies with the tab, the right lifetime for a
// stranger's ID number on a device we don't own.

// The typed identity must survive a full navigation to the vendor's domain and back —
// React state doesn't (the page is destroyed and rebuilt), and without it
// resolveVerification would cross-check against two empty strings, silently disabling the
// substitution defence.
export const IDENTITY_STASH_KEY = 'fp_handover_identity'

// PII-free on purpose: a token and a state, never the typed name or ID number.
export const CONFIRM_OUTCOME_KEY = 'fp_handover_outcome'

export interface StashedIdentity {
  name: string
  idNumber: string
  /** The mock vendor page carries no capability token, so the return path travels with the identity. */
  token: string
}

/**
 * 'attempted': a confirm request left this device and we never saw it succeed.
 * 'confirmed': the server said yes.
 */
export type ConfirmOutcome = 'attempted' | 'confirmed'

interface StoredOutcome {
  token: string
  state: ConfirmOutcome
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isConfirmOutcome(value: unknown): value is ConfirmOutcome {
  return value === 'attempted' || value === 'confirmed'
}

// Logs the error's name only. A JSON.parse SyntaxError quotes a slice of the text it choked
// on, and this storage holds a stranger's name and ID number, so the object itself must not
// reach the console.
function warnStorage(action: string, err: unknown): void {
  console.warn(`[handover] sessionStorage ${action} failed:`, err instanceof Error ? err.name : 'unknown')
}

export function stashIdentity(identity: StashedIdentity): void {
  try {
    sessionStorage.setItem(IDENTITY_STASH_KEY, JSON.stringify(identity))
  } catch (err: unknown) {
    // Storage unavailable — the cross-check degrades to "nothing to compare".
    warnStorage('write', err)
  }
}

export function readStashedIdentity(): StashedIdentity | null {
  try {
    const raw = sessionStorage.getItem(IDENTITY_STASH_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      isRecord(parsed) &&
      typeof parsed.name === 'string' &&
      typeof parsed.idNumber === 'string' &&
      typeof parsed.token === 'string'
    ) {
      return { name: parsed.name, idNumber: parsed.idNumber, token: parsed.token }
    }
    return null
  } catch (err: unknown) {
    warnStorage('read', err)
    return null
  }
}

export function clearStashedIdentity(): void {
  try {
    sessionStorage.removeItem(IDENTITY_STASH_KEY)
  } catch (err: unknown) {
    warnStorage('clear', err)
  }
}

/**
 * Remember how far a confirm got, so a reload after a lost response can say something
 * truthful: the server answers a redeemed token with the same 404 as a dead one, and
 * without this marker a receiver who really did confirm is told their link is invalid.
 */
export function rememberConfirmOutcome(token: string, state: ConfirmOutcome): void {
  try {
    const outcome: StoredOutcome = { token, state }
    sessionStorage.setItem(CONFIRM_OUTCOME_KEY, JSON.stringify(outcome))
  } catch (err: unknown) {
    warnStorage('write', err)
  }
}

/** The recorded outcome for THIS token only — a marker left by another delivery reads as null. */
export function readConfirmOutcome(token: string): ConfirmOutcome | null {
  try {
    const raw = sessionStorage.getItem(CONFIRM_OUTCOME_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed) && parsed.token === token && isConfirmOutcome(parsed.state)) {
      return parsed.state
    }
    return null
  } catch (err: unknown) {
    warnStorage('read', err)
    return null
  }
}
