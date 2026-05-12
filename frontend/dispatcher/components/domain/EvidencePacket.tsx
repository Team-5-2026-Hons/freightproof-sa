import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { TripIdStamp } from './TripIdStamp'
import { TimestampWithIcon } from './TimestampWithIcon'
import type { ReactNode } from 'react'
import type { ChipKind } from '@shared/lib/constants/status-meta'
import { cn } from '@shared/lib/utils/cn'

interface EvidencePacketProps {
  /** Status chip kind */
  chipKind: ChipKind
  /** Status chip label */
  chipLabel: string
  /** Optional ID stamp (e.g. trip reference) */
  idStamp?: string
  /** Title of the evidence packet */
  title: string
  /** Evidence rows — typically labels and values */
  children: ReactNode
  /** Optional footer with action buttons */
  footer?: ReactNode
  /** Use exception variant styling */
  exception?: boolean
  className?: string
}

/**
 * Standardised evidence content block with status chip header, ID stamp, title,
 * content rows, and optional footer. The primary reusable content block per spec §5.2.
 */
export function EvidencePacket({
  chipKind,
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
      {/* Header row */}
      <div className="flex items-center gap-3 mb-3">
        <Chip kind={chipKind}>{chipLabel}</Chip>
        {idStamp && <TripIdStamp tripReference={idStamp} />}
      </div>

      {/* Title */}
      <h3 className="text-lg font-bold text-surface-on mb-3">{title}</h3>

      {/* Content */}
      <div className="space-y-2">
        {children}
      </div>

      {/* Footer actions */}
      {footer && (
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-outline-variant/20">
          {footer}
        </div>
      )}
    </Card>
  )
}
