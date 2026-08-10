import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { TripIdStamp } from './TripIdStamp'
import type { ReactNode } from 'react'
import type { ChipType } from '@shared/lib/constants/status-meta'
import { cn } from '@shared/lib/utils/cn'

interface EvidencePacketProps {
  chipType: ChipType
  chipLabel: string
  idStamp?: string
  title: string
  children: ReactNode
  footer?: ReactNode
  exception?: boolean
  className?: string
}

export function EvidencePacket({
  chipType,
  chipLabel,
  idStamp,
  title,
  children,
  footer,
  exception = false,
  className,
}: EvidencePacketProps) {
  return (
    <Card variant={exception ? 'exception' : 'default'} className={cn('p-5', className)}>
      <div className="flex items-center gap-3 mb-3">
        <Chip type={chipType} label={chipLabel} />
        {idStamp && <TripIdStamp tripReference={idStamp} />}
      </div>
      <h3 className="text-lg font-bold text-surface-on mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
      {footer && (
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-outline-variant/20">
          {footer}
        </div>
      )}
    </Card>
  )
}
