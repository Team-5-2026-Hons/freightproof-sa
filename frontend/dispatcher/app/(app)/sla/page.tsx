'use client'

import { useState } from 'react'
import { TopBar }         from '@/components/ui/TopBar'
import { Button }         from '@/components/ui/Button'
import { Ic }             from '@/components/ui/Ic'
import { Card }           from '@/components/ui/Card'
import { EmptyState }     from '@/components/ui/EmptyState'
import { useSLAMetrics }  from '@/lib/hooks/useSLAMetrics'
import type { DateRange } from '@/lib/types/date-range'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function thirtyDaysAgo(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

export default function SLAPage() {
  const [range] = useState<DateRange>({ from: thirtyDaysAgo(), to: todayStr() })
  const metrics = useSLAMetrics({ range })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="SLA Reports">
        <Button variant="ghost" size="sm" iconLeft={<Ic n="dl" s={14} className="text-sec" />}>
          Export PDF
        </Button>
      </TopBar>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-6 py-4 bg-surf-low border-b border-outline-v/20 shrink-0">
        <span className="text-[12px] font-[600] text-on-surf-v">
          {range.from} — {range.to}
        </span>
        <span className="text-[11px] text-on-surf-v">(date range picker — Phase 1 hook)</span>
      </div>

      {/* 2×2 chart grid */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-5">
            <p className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v mb-4">On-time pickup %</p>
            {metrics ? (
              <p className="text-[28px] font-[800] text-ok">{metrics.onTimePickupPct}%</p>
            ) : (
              <EmptyState icon={<Ic n="bars" s={24} className="text-on-surf-v" />} title="No data" body="No trips in this period." />
            )}
          </Card>

          <Card className="p-5">
            <p className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v mb-4">On-time delivery %</p>
            {metrics ? (
              <p className="text-[28px] font-[800] text-ok">{metrics.onTimeDeliveryPct}%</p>
            ) : (
              <EmptyState icon={<Ic n="bars" s={24} className="text-on-surf-v" />} title="No data" body="No trips in this period." />
            )}
          </Card>

          <Card className="p-5">
            <p className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v mb-4">Exceptions by type</p>
            {metrics ? (
              <div className="space-y-2">
                {Object.entries(metrics.exceptionsByType).map(([type, count]) => (
                  <div key={type} className="flex justify-between text-[13px]">
                    <span className="text-on-surf-v capitalize">{type.replace(/_/g, ' ')}</span>
                    <span className="font-[700] text-on-surf">{count as number}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Ic n="warn" s={24} className="text-on-surf-v" />} title="No data" body="No exceptions in this period." />
            )}
          </Card>

          <Card className="p-5">
            <p className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v mb-4">Handshake completion rate</p>
            {metrics ? (
              <p className="text-[28px] font-[800] text-on-surf">{metrics.handshakeCompletionPct}%</p>
            ) : (
              <EmptyState icon={<Ic n="check" s={24} className="text-on-surf-v" />} title="No data" body="No trips in this period." />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
