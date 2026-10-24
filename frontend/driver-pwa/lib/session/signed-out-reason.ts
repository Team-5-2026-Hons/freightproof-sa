// sessionStorage, not localStorage: this explains one forced sign-out to the next login
// screen of this launch, and is not a durable fact about the device.
export const SIGNED_OUT_REASON_KEY = 'fp.signedOutReason'

export function rememberSignedOutReason(message: string): void {
  try {
    window.sessionStorage.setItem(SIGNED_OUT_REASON_KEY, message)
  } catch (err) {
    // The sign-out itself must still go ahead; only the explanation is lost.
    console.warn('[session] could not remember why the driver was signed out:', err)
  }
}

/** The remembered reason, removed as it is read so it shows once. Null when there is none. */
export function consumeSignedOutReason(): string | null {
  try {
    const reason = window.sessionStorage.getItem(SIGNED_OUT_REASON_KEY)
    if (reason !== null) window.sessionStorage.removeItem(SIGNED_OUT_REASON_KEY)
    return reason
  } catch (err) {
    console.warn('[session] could not read the sign-out reason:', err)
    return null
  }
}
