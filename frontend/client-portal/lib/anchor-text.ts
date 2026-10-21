// Plain-words wording for each browser-check outcome, shared by every place that reports one
// (the verification panel, the seal page, the PDF check) so the same state never reads two ways.
import type { AnchorCheckState } from './verify'

export interface StateText {
  text: string
  /** A design-token text class: ok = confirmed, err = contradicted, warn = not confirmed. */
  tone: string
}

export const UNSUPPORTED_TEXT = 'This browser cannot verify (needs a secure HTTPS page)'

export const ANCHOR_STATE_TEXT: Record<AnchorCheckState, StateText> = {
  verified: { text: 'Verified on Hedera', tone: 'text-ok' },
  hash_mismatch: { text: 'Payload does not match its hash', tone: 'text-err' },
  ledger_mismatch: { text: 'Hedera holds a different hash', tone: 'text-err' },
  topic_mismatch: { text: 'Anchored on a topic FreightProof does not use', tone: 'text-err' },
  not_found: {
    text: 'No message at this ledger position — not evidence of tampering (ledger reset or wrong position)',
    tone: 'text-warn',
  },
  unavailable: { text: 'Hedera mirror unreachable — try again', tone: 'text-warn' },
  unsupported: { text: UNSUPPORTED_TEXT, tone: 'text-warn' },
  no_receipt: { text: 'No ledger position recorded', tone: 'text-warn' },
}
