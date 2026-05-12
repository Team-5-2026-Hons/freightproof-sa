'use client'

import { BarChart3 } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { COPY } from '@shared/lib/constants/copy'

export default function SlaPage() {
  return (
    <PageShell>
      <PageHeader title="SLA Reports" />
      
      <EmptyState
        icon={<BarChart3 />}
        title={COPY.emptyState.slaNoData.title}
        body={COPY.emptyState.slaNoData.body}
      />
    </PageShell>
  )
}
