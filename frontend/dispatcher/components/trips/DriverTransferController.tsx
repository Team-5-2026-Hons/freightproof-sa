'use client'

import { useState, type ReactNode } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import { Modal } from '@/components/ui/Modal'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { DriverSubstitutionDialog } from './DriverSubstitutionDialog'
import { PendingHandover } from './DriverSubstitutionPanel'

interface Props {
  trip: Trip
  onChanged: () => void
  children: (openTransfer: () => void) => ReactNode
}

export function transferActionFor(trip: Trip, onClick: () => void): { label: 'Transfer driver' | 'View transfer'; onClick: () => void } | null {
  if (trip.pending_driver_substitution) return { label: 'View transfer', onClick }
  return trip.driver_substitutions_enabled === true && ['active', 'exception_hold'].includes(trip.status)
    ? { label: 'Transfer driver', onClick } : null
}

export function DriverTransferController({ trip, onChanged, children }: Props): React.JSX.Element {
  const [mode, setMode] = useState<'arrange' | 'pending' | 'replace' | null>(null)
  const [generation, setGeneration] = useState(0)
  const { drivers } = useDrivers()
  const pending = trip.pending_driver_substitution ?? null
  const enabled = trip.driver_substitutions_enabled === true
  function openTransfer(): void {
    if (!transferActionFor(trip, openTransfer)) return
    setGeneration(value => value + 1)
    setMode(pending ? 'pending' : 'arrange')
  }
  const replacing = mode === 'replace' ? pending : null
  return <>
    {children(openTransfer)}
    {mode === 'pending' && <Modal open onClose={() => setMode(null)} title="Driver transfer" size="md">
      {pending ? <PendingHandover tripId={trip.id} request={pending} canReplace={enabled} onChanged={onChanged}
        onReplace={() => { setGeneration(value => value + 1); setMode('replace') }} /> : <p>No pending transfer. The trip record has been refreshed.</p>}
    </Modal>}
    {(mode === 'arrange' || (mode === 'replace' && pending)) && <DriverSubstitutionDialog key={generation} tripId={trip.id} open
      outgoingDriverName={trip.driver?.full_name} drivers={drivers.filter(driver => driver.id !== trip.driver?.id)} replacing={replacing}
      onClose={() => setMode(null)} onSaved={() => { setMode(null); onChanged() }} />}
  </>
}
