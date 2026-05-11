"use client"

import { useMemo } from 'react'
import type { HandshakeNumber } from '@shared/lib/types/handshake'
import { HANDSHAKE_NAMES, HANDSHAKE_STEP_COUNTS, STEP_NAMES } from '@shared/lib/constants/handshake-meta'

export interface StepIndicator {
  handshakeName: string
  stepName: string
  current: number
  total: number
}

export function useStepIndicator(handshake: HandshakeNumber, step: number): StepIndicator {
  return useMemo(() => ({
    handshakeName: HANDSHAKE_NAMES[handshake],
    stepName: handshake >= 1
      ? (STEP_NAMES[handshake as 1 | 2 | 3 | 4 | 5]?.[step - 1] ?? '')
      : '',
    current: step,
    total: HANDSHAKE_STEP_COUNTS[handshake],
  }), [handshake, step])
}
