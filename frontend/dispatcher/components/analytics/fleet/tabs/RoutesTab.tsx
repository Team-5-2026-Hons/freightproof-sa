'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Ic } from '@/components/ui/Ic'
import { ROUTES } from '@/lib/constants/routes'
import { NO_DATA, fmtMinutes } from '@/lib/format/analytics'
import { fmtExceptionType } from '@/lib/format/exception'
import { LOW_SAMPLE_TRIPS, fmtSastDay, type TabQuery } from '@/lib/format/period'
import { useFleetIncidents, useFleetRoutes, type FleetQueryResult } from '@/lib/hooks/useFleetAnalytics'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { LANE_BAD_DAY_COLOR, LANE_TYPICAL_COLOR, SERIES_COLORS, STATUS_COLORS } from '@/lib/tokens'
import type { FleetIncidents, FleetRoutes, LaneRisk, SiteActivity } from '@shared/lib/types/fleet-analytics'
import { ChartCard, queryState } from '../ChartCard'
import { CategoryBars } from '../charts/CategoryBars'
import { ChartLegend } from '../charts/ChartLegend'
import { ChartTooltip } from '../charts/ChartTooltip'
import { PARTIAL_OPACITY } from '../charts/chartStyle'
import { LaneScatter } from '../charts/LaneScatter'
import { FLEET_COPY } from '../copy'
import { sumOf } from '../format'
import { INCIDENT_MAP_HEIGHT, IncidentMap, type PinSelection } from '../map/IncidentMap'

const COPY = FLEET_COPY.routes
// Enough to see the busiest places at a glance; "Show all" opens the rest.
const TOP_SITES = 10
// The incident table grows ten rows at a time, so the map stays near the rows.
const INCIDENT_PAGE_SIZE = 10
const RATIO_DECIMALS = 2
// Lane names are long ("Bloemfontein Depot (Hamilton) → Johannesburg Depot (Linbro)"): a wider
// name column keeps most to two lines, and a taller row keeps each lane's bars and name together.
const LANE_AXIS_WIDTH = 280
const LANE_ROW_HEIGHT = 64
const LANE_GAP = '30%'
const LEGEND_ICON_SIZE = 12
const [PICKUP_COLOR, DELIVERY_COLOR] = SERIES_COLORS

function siteName(site: SiteActivity): string {
  return site.precinct_name ?? COPY.unknownSite
}

function laneName(lane: LaneRisk): string {
  return COPY.lane(lane.origin_name ?? COPY.unknownSite, lane.destination_name ?? COPY.unknownSite)
}

function laneKey(lane: LaneRisk): string {
  return `${lane.origin_precinct_id}→${lane.destination_precinct_id}`
}

/** Fewer trips than this and a lane's typical and bad-day times aren't worth comparing. */
function isShortLane(lane: LaneRisk): boolean {
  return lane.trip_count < LOW_SAMPLE_TRIPS
}

interface SiteRow {
  site: string
  pickups: number
  deliveries: number
  total: number
}

/** Chart 1.6: pickups under deliveries per site, busiest first; the ten busiest drawn, the
 *  table lists every one. */
function SitesCard({ routes }: { routes: FleetQueryResult<FleetRoutes> }) {
  const [showAll, setShowAll] = useState(false)
  const sites = routes.data?.sites ?? []
  const shown = showAll ? sites : sites.slice(0, TOP_SITES)
  const total = sumOf(sites, (site) => site.pickup_count + site.delivery_count)
  const tableRows: SiteRow[] = sites.map((site) => ({
    site: siteName(site),
    pickups: site.pickup_count,
    deliveries: site.delivery_count,
    total: site.pickup_count + site.delivery_count,
  }))
  const columns: Column<SiteRow>[] = [
    { key: 'site', label: COPY.sites.site },
    { key: 'pickups', label: COPY.sites.pickups },
    { key: 'deliveries', label: COPY.sites.deliveries },
    { key: 'total', label: COPY.sites.total },
  ]

  return (
    <ChartCard
      title={COPY.sites.title}
      question={COPY.sites.question}
      basis={COPY.sites.basis(total)}
      controls={sites.length > TOP_SITES ? (
        <Button size="sm" variant="ghost" onClick={() => setShowAll((all) => !all)}>
          {showAll ? COPY.sites.showTop(TOP_SITES) : COPY.sites.showAll(sites.length)}
        </Button>
      ) : undefined}
      legend={
        <ChartLegend
          items={[
            { label: COPY.sites.pickups, color: PICKUP_COLOR, mark: 'bar' },
            { label: COPY.sites.deliveries, color: DELIVERY_COLOR, mark: 'bar' },
          ]}
        />
      }
      {...queryState(routes)}
      isEmpty={sites.length === 0}
      emptyBody={COPY.sites.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <CategoryBars<SiteActivity>
        orientation="bars"
        rows={shown}
        rowKey={(site) => site.precinct_id}
        categoryLabel={siteName}
        yLabel={COPY.axis.sites}
        series={[
          { key: 'pickups', label: COPY.sites.pickups, color: () => PICKUP_COLOR, value: (site) => site.pickup_count },
          { key: 'deliveries', label: COPY.sites.deliveries, color: () => DELIVERY_COLOR, value: (site) => site.delivery_count },
        ]}
        renderTooltip={(site) => (
          <ChartTooltip
            title={siteName(site)}
            lines={[
              { value: String(site.pickup_count), label: COPY.sites.pickups.toLowerCase(), color: PICKUP_COLOR },
              { value: String(site.delivery_count), label: COPY.sites.deliveries.toLowerCase(), color: DELIVERY_COLOR },
            ]}
          />
        )}
      />
    </ChartCard>
  )
}

interface LaneTimeRow {
  lane: string
  trips: number
  typical: string
  badDay: string
}

/** Chart 2.4: typical (median) and bad-day (P90) driving time per lane, two steps of one blue.
 *  Lanes on too few trips are faded and say so. Full width so long lane names and both bars
 *  have room. */
function LaneTimesCard({ routes }: { routes: FleetQueryResult<FleetRoutes> }) {
  const lanes = (routes.data?.lanes ?? []).filter((lane) => lane.driving_minutes.sample_count > 0)
  const timed = sumOf(lanes, (lane) => lane.driving_minutes.sample_count)
  const hasShortLane = lanes.some(isShortLane)
  const tableRows: LaneTimeRow[] = lanes.map((lane) => ({
    lane: laneName(lane),
    trips: lane.trip_count,
    typical: fmtMinutes(lane.driving_minutes.median),
    badDay: fmtMinutes(lane.driving_minutes.p90),
  }))
  const columns: Column<LaneTimeRow>[] = [
    { key: 'lane', label: COPY.laneTimes.lane },
    { key: 'trips', label: COPY.laneTimes.trips },
    { key: 'typical', label: COPY.laneTimes.typical },
    { key: 'badDay', label: COPY.laneTimes.badDay },
  ]
  const fade = (lane: LaneRisk): number => (isShortLane(lane) ? PARTIAL_OPACITY : 1)

  return (
    <ChartCard
      className="lg:col-span-2"
      title={COPY.laneTimes.title}
      question={COPY.laneTimes.question}
      basis={COPY.laneTimes.basis(timed)}
      legend={
        <ChartLegend
          items={[
            { label: COPY.laneTimes.typical, color: LANE_TYPICAL_COLOR, mark: 'bar' },
            { label: COPY.laneTimes.badDay, color: LANE_BAD_DAY_COLOR, mark: 'bar' },
          ]}
          note={hasShortLane ? COPY.laneTimes.fadedNote : undefined}
        />
      }
      {...queryState(routes)}
      isEmpty={lanes.length === 0}
      emptyBody={COPY.laneTimes.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <CategoryBars<LaneRisk>
        orientation="bars"
        stacked={false}
        categoryAxisWidth={LANE_AXIS_WIDTH}
        rowHeight={LANE_ROW_HEIGHT}
        categoryGap={LANE_GAP}
        rows={lanes}
        rowKey={laneKey}
        categoryLabel={(lane) => (isShortLane(lane) ? `${laneName(lane)} (${COPY.laneTimes.tooFew})` : laneName(lane))}
        yLabel={COPY.axis.minutes}
        series={[
          { key: 'typical', label: COPY.laneTimes.typical, color: () => LANE_TYPICAL_COLOR, value: (lane) => lane.driving_minutes.median ?? 0, opacity: fade },
          { key: 'badDay', label: COPY.laneTimes.badDay, color: () => LANE_BAD_DAY_COLOR, value: (lane) => lane.driving_minutes.p90 ?? 0, opacity: fade },
        ]}
        renderTooltip={(lane) => (
          <ChartTooltip
            title={laneName(lane)}
            lines={[
              { value: fmtMinutes(lane.driving_minutes.median), label: COPY.laneTimes.typical, color: LANE_TYPICAL_COLOR },
              { value: fmtMinutes(lane.driving_minutes.p90), label: COPY.laneTimes.badDay, color: LANE_BAD_DAY_COLOR },
            ]}
            note={`${lane.trip_count} ${COPY.laneTimes.trips.toLowerCase()}${isShortLane(lane) ? ` · ${COPY.laneTimes.tooFew}` : ''}`}
          />
        )}
      />
    </ChartCard>
  )
}

interface LaneRiskRow {
  lane: string
  trips: number
  problems: number
  perTrip: string
}

/** Chart 6.3: one dot per lane, trips across and problems per trip up. Each dot is named,
 *  lines at the average lane split the chart into corners, and the top-right corner is
 *  labelled. The table is sorted riskiest first. */
function LaneRiskCard({ routes }: { routes: FleetQueryResult<FleetRoutes> }) {
  const lanes = routes.data?.lanes ?? []
  const tableRows: LaneRiskRow[] = [...lanes]
    .sort((a, b) => (b.problems_per_trip ?? -1) - (a.problems_per_trip ?? -1) || b.trip_count - a.trip_count)
    .map((lane) => ({
      lane: laneName(lane),
      trips: lane.trip_count,
      problems: lane.problem_count,
      perTrip: lane.problems_per_trip === null ? NO_DATA : lane.problems_per_trip.toFixed(RATIO_DECIMALS),
    }))
  const columns: Column<LaneRiskRow>[] = [
    { key: 'lane', label: COPY.laneTimes.lane },
    { key: 'trips', label: COPY.laneRisk.trips },
    { key: 'problems', label: COPY.laneRisk.problems },
    { key: 'perTrip', label: COPY.laneRisk.perTrip },
  ]

  return (
    <ChartCard
      title={COPY.laneRisk.title}
      question={COPY.laneRisk.question}
      basis={COPY.laneRisk.basis(lanes.length)}
      note={COPY.laneRisk.note}
      {...queryState(routes)}
      isEmpty={lanes.length === 0}
      emptyBody={COPY.laneRisk.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <LaneScatter<LaneRisk>
        rows={lanes}
        rowKey={laneKey}
        x={(lane) => lane.trip_count}
        y={(lane) => lane.problems_per_trip ?? 0}
        xLabel={COPY.axis.tripsOnLane}
        yLabel={COPY.axis.problemsPerTrip}
        color={SERIES_COLORS[0]}
        pointLabel={laneName}
        cornerLabel={COPY.laneRisk.corner}
        renderTooltip={(lane) => (
          <ChartTooltip
            title={laneName(lane)}
            lines={[{
              value: lane.problems_per_trip === null ? NO_DATA : lane.problems_per_trip.toFixed(RATIO_DECIMALS),
              label: COPY.laneRisk.perTrip.toLowerCase(),
              color: SERIES_COLORS[0],
            }]}
            note={COPY.laneRisk.tooltip(lane.trip_count, lane.problem_count)}
          />
        )}
      />
    </ChartCard>
  )
}

interface PinRow {
  date: string
  problem: string
  severity: string
  trip: string
  tripId: string
  exceptionId: string
}

interface IncidentsCardProps {
  incidents: FleetQueryResult<FleetIncidents>
  returnTo: string
}

/** Chart 3.6: the map, with its table twin always under it and the count of reports that had
 *  no location. Nothing about the driver anywhere: the pins don't carry it. The table shows
 *  ten rows at a time with "Load more"; clicking a row finds its pin on the map, and every
 *  "Open" carries `returnTo` so the report's Back button comes straight back here. */
function IncidentsCard({ incidents, returnTo }: IncidentsCardProps) {
  const [shownCount, setShownCount] = useState(INCIDENT_PAGE_SIZE)
  const [selection, setSelection] = useState<PinSelection | null>(null)
  const pins = incidents.data?.pins ?? []
  const unlocated = incidents.data?.unlocated_count ?? 0
  const rows: PinRow[] = pins.map((pin) => ({
    date: fmtSastDay(pin.created_at),
    problem: fmtExceptionType(pin.exception_type),
    severity: COPY.incidents.severities[pin.severity],
    trip: pin.trip_reference,
    tripId: pin.trip_id,
    exceptionId: pin.exception_id,
  }))
  const visible = rows.slice(0, shownCount)
  const remaining = rows.length - visible.length
  const columns: Column<PinRow>[] = [
    { key: 'date', label: COPY.incidents.columns.date },
    { key: 'problem', label: COPY.incidents.columns.problem },
    { key: 'severity', label: COPY.incidents.columns.severity },
    {
      key: 'trip', label: COPY.incidents.columns.trip,
      render: (_value, row) => <Link href={ROUTES.tripDetail(row.tripId)} className="font-[600] text-sec hover:underline">{row.trip}</Link>,
    },
    {
      key: 'exceptionId', label: COPY.incidents.columns.open,
      render: (_value, row) => (
        <Link href={withReturnTo(ROUTES.exceptionDetail(row.exceptionId), returnTo)} className="font-[600] text-sec hover:underline">
          {COPY.incidents.open}
        </Link>
      ),
    },
  ]
  const table = (
    <div className="flex flex-col gap-2">
      {rows.length > 0 && (
        <p className="text-[12px] text-on-surf-v">
          {`${COPY.incidents.showing(visible.length, rows.length)} · ${COPY.incidents.rowHint}`}
        </p>
      )}
      <DataTable
        columns={columns}
        rows={visible}
        onRowClick={(row) => setSelection((current) => ({ id: row.exceptionId, seq: (current?.seq ?? 0) + 1 }))}
      />
      {remaining > 0 && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setShownCount((count) => count + INCIDENT_PAGE_SIZE)}>
            {COPY.incidents.loadMore(Math.min(remaining, INCIDENT_PAGE_SIZE))}
          </Button>
        </div>
      )}
    </div>
  )
  const unlocatedLine = unlocated > 0 ? COPY.incidents.unlocated(unlocated) : undefined

  return (
    <ChartCard
      className="lg:col-span-2"
      title={COPY.incidents.title}
      question={COPY.incidents.question}
      basis={COPY.incidents.basis(pins.length)}
      caveat={unlocatedLine}
      legend={
        <ChartLegend
          items={[
            { label: COPY.incidents.severities.warning, color: STATUS_COLORS.warning, mark: 'bar', icon: <Ic n="warn" s={LEGEND_ICON_SIZE} /> },
            { label: COPY.incidents.severities.critical, color: STATUS_COLORS.critical, mark: 'bar', icon: <Ic n="siren" s={LEGEND_ICON_SIZE} /> },
          ]}
        />
      }
      {...queryState(incidents)}
      isEmpty={pins.length === 0}
      emptyBody={unlocatedLine === undefined ? COPY.incidents.empty : `${COPY.incidents.empty} ${unlocatedLine}`}
      chartHeight={INCIDENT_MAP_HEIGHT}
      table={table}
    >
      <div className="flex flex-col gap-3">
        <IncidentMap pins={pins} selection={selection} returnTo={returnTo} />
        {table}
      </div>
    </ChartCard>
  )
}

interface RoutesTabProps {
  /** Only its start and end are used: this tab has no View by. */
  query: TabQuery
  /** Where a report opened from the map should send Back: this tab, as it is now. */
  returnTo: string
}

/** Routes & sites tab: busiest sites and lane risk side by side, then driving time per lane
 *  and the map across the full width. Two requests, both for the period alone. */
export function RoutesTab({ query, returnTo }: RoutesTabProps) {
  const period = { start: query.start, end: query.end }
  const routes = useFleetRoutes(period)
  const incidents = useFleetIncidents(period)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SitesCard routes={routes} />
      <LaneRiskCard routes={routes} />
      <LaneTimesCard routes={routes} />
      {/* Keyed by the period: a new period starts the table at ten rows with nothing chosen. */}
      <IncidentsCard key={`${period.start ?? 'all'}-${period.end}`} incidents={incidents} returnTo={returnTo} />
    </div>
  )
}
