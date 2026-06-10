'use client'

import { useParams, useRouter } from 'next/navigation'
import { HANDSHAKE_NAMES, STEP_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'

const HANDSHAKE_NUMBERS = [1, 2, 3, 4, 5] as const

export default function HandshakeStepPage() {
  const { id, step } = useParams<{ id: string; step: string }>()
  const router = useRouter()

  // STEP_SLUGS is keyed by handshake number; find which handshake owns this slug.
  const handshakeNumber = HANDSHAKE_NUMBERS.find((n) => STEP_SLUGS[n].includes(step))
  const stepIndex = handshakeNumber ? STEP_SLUGS[handshakeNumber].indexOf(step) : -1
  const handshakeName = handshakeNumber ? HANDSHAKE_NAMES[handshakeNumber] : step
  const stepName =
    handshakeNumber && stepIndex >= 0 ? STEP_NAMES[handshakeNumber][stepIndex] : step

  return (
    <main className="min-h-screen p-4">
      <button onClick={() => router.back()} className="mb-4 text-sm text-blue-600">← Back</button>
      <p className="text-sm text-gray-500">{handshakeName}</p>
      <h1 className="text-xl font-semibold mb-1">{stepName}</h1>
      <p className="mb-6 text-sm text-gray-500">Trip: {id}</p>

      {/* Replace in Iter 2 with real checklist + hold-to-confirm per step (FP-67–FP-92) */}
      <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400">
        <p className="text-sm">Handshake UI for <strong>{step}</strong></p>
        <p className="mt-1 text-xs">Implement in Iteration 2</p>
      </div>
    </main>
  )
}
