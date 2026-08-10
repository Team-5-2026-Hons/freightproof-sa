"use client"

import { useContext } from 'react'
import { TripContext } from '@/lib/context/TripContext'

export function useTrip() {
  const ctx = useContext(TripContext)
  if (!ctx) throw new Error('useTrip must be used inside TripProvider')
  return ctx
}
