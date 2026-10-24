'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { JOURNEY, SECTIONS } from '@/lib/landing/content'
import {
  buildRoadPath,
  cameraFraction,
  headingDegrees,
  lengthAtY,
  pointAtLength,
  stepCriticalSpring,
  type Point,
  type RoadSample,
  type SpringState,
} from '@/lib/landing/roadPath'
import { cn } from '@shared/lib/utils/cn'
import { SampleRecord } from './SampleRecord'
import { Truck } from './Truck'
import styles from './landing.module.css'

// Sampling interval along the road. 4px keeps the lookup table a few thousand entries on
// the longest page while staying well under a pixel of visible error after interpolation.
const SAMPLE_STEP_PX = 4
// Apple's "response": how quickly the truck catches up with the scroll. Short enough to
// feel glued to the wheel, long enough to smooth out mouse-wheel steps.
const SPRING_RESPONSE_S = 0.2
// A backgrounded tab can hand back a huge frame delta; the spring is exact for any dt,
// but clamping keeps the first frame back from teleporting the truck.
const MAX_FRAME_S = 1 / 20
const SETTLE_EPSILON = 0.35
// How far ahead/behind to look when working out which way the truck is facing.
const HEADING_LOOKAHEAD_PX = 8
const SEAL_TOLERANCE_PX = 2
const ROAD_BEND = 0.62
// The truck is drawn centred on its position, so at the destination it would overhang the
// end of the road by half its length (plus the headlight throw). Park it short instead.
const PARK_INSET_PX = 56
const DESKTOP_QUERY = '(min-width: 768px)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const ROAD = {
  desktop: { width: 58, truckScale: 1 },
  mobile: { width: 30, truckScale: 0.56 },
} as const

// Illustrative fingerprints only. The section says so; real ones come from the ledger.
const SAMPLE_HASHES = [
  '9f2c41ab…3d1a',
  '04be7d19…c2f7',
  'e81a0c5d…7b40',
  '5d93f0e2…18ac',
  'b7c6214f…e905',
  '2fa8d1c7…6e3b',
  'c40e97b2…0fd8',
] as const

interface Geometry {
  width: number
  height: number
  d: string
  points: Point[]
  desktop: boolean
}

export function RoadJourney() {
  const sectionRef = useRef<HTMLElement>(null)
  // [origin, ...one per stop, destination] — the road is drawn through their centres.
  const anchorRefs = useRef<(HTMLSpanElement | null)[]>([])
  const stopRefs = useRef<(HTMLLIElement | null)[]>([])
  const roadRef = useRef<SVGPathElement>(null)
  const trailRef = useRef<SVGPathElement>(null)
  const truckRef = useRef<SVGGElement>(null)

  const samplesRef = useRef<RoadSample[]>([])
  const stopLengthsRef = useRef<number[]>([])
  const totalRef = useRef(0)
  const springRef = useRef<SpringState>({ value: 0, velocity: 0 })
  const placedRef = useRef(false)
  const requestTickRef = useRef<() => void>(() => {})
  const geoRef = useRef<Geometry | null>(null)

  const [geo, setGeo] = useState<Geometry | null>(null)

  const measure = useCallback(() => {
    const section = sectionRef.current
    if (!section) return
    const box = section.getBoundingClientRect()
    const points: Point[] = []
    for (const anchor of anchorRefs.current) {
      if (!anchor) return
      const r = anchor.getBoundingClientRect()
      points.push({ x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top })
    }
    setGeo({
      width: box.width,
      height: box.height,
      d: buildRoadPath(points, ROAD_BEND),
      points,
      desktop: window.matchMedia(DESKTOP_QUERY).matches,
    })
  }, [])

  // The frame loop lives in one effect as plain functions: it runs every frame while the
  // page scrolls, so it writes straight to the DOM through refs instead of re-rendering.
  useEffect(() => {
    let frame: number | null = null
    let lastTime: number | null = null
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY)

    function paint(length: number): void {
      const samples = samplesRef.current
      const geometry = geoRef.current
      if (samples.length === 0 || !geometry) return

      const scale = geometry.desktop ? ROAD.desktop.truckScale : ROAD.mobile.truckScale
      const parked = Math.min(length, totalRef.current - PARK_INSET_PX * scale)
      const here = pointAtLength(samples, parked)
      const behind = pointAtLength(samples, parked - HEADING_LOOKAHEAD_PX)
      const ahead = pointAtLength(samples, parked + HEADING_LOOKAHEAD_PX)
      const angle = headingDegrees(behind, ahead)
      truckRef.current?.setAttribute(
        'transform',
        `translate(${here.x.toFixed(1)} ${here.y.toFixed(1)}) rotate(${angle.toFixed(2)}) scale(${scale})`,
      )
      trailRef.current?.style.setProperty('stroke-dashoffset', String(totalRef.current - length))

      let nextFound = false
      stopLengthsRef.current.forEach((stopLength, i) => {
        const stop = stopRefs.current[i]
        if (!stop) return
        const isSealed = length >= stopLength - SEAL_TOLERANCE_PX
        // Only the first unsealed checkpoint is "next"; the rest are simply pending.
        const isNext = !isSealed && !nextFound
        if (isNext) nextFound = true
        const sealed = String(isSealed)
        const next = String(isNext)
        if (stop.dataset.sealed !== sealed) stop.dataset.sealed = sealed
        if (stop.dataset.next !== next) stop.dataset.next = next
      })
    }

    function tick(now: number): void {
      frame = null
      const section = sectionRef.current
      const samples = samplesRef.current
      if (!section || samples.length === 0) return

      const viewport = window.innerHeight
      const line = viewport * cameraFraction(window.scrollY, viewport) - section.getBoundingClientRect().top
      const target = lengthAtY(samples, line)

      let state = springRef.current
      if (!placedRef.current || reducedMotion.matches) {
        // First placement (e.g. a reload halfway down the page) and reduced motion both
        // put the truck exactly where the scroll says, with no catch-up animation.
        state = { value: target, velocity: 0 }
        placedRef.current = true
      } else {
        const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, MAX_FRAME_S)
        state = stepCriticalSpring(state, target, dt, SPRING_RESPONSE_S)
      }
      springRef.current = state
      paint(state.value)

      const settled = Math.abs(state.value - target) < SETTLE_EPSILON && Math.abs(state.velocity) < SETTLE_EPSILON
      if (settled) {
        lastTime = null
      } else {
        lastTime = now
        frame = requestAnimationFrame(tick)
      }
    }

    function requestTick(): void {
      if (frame === null) frame = requestAnimationFrame(tick)
    }

    requestTickRef.current = requestTick
    window.addEventListener('scroll', requestTick, { passive: true })
    window.addEventListener('resize', requestTick)
    requestTick()
    return () => {
      requestTickRef.current = () => {}
      window.removeEventListener('scroll', requestTick)
      window.removeEventListener('resize', requestTick)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  // Re-measure whenever layout can move an anchor: size changes, breakpoint flips, and
  // the web font swapping in (which reflows every card).
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    measure()
    const observer = new ResizeObserver(() => measure())
    observer.observe(section)
    void document.fonts?.ready.then(() => measure())
    return () => observer.disconnect()
  }, [measure])

  // New road geometry: rebuild the lookup table from the path the browser actually drew.
  useLayoutEffect(() => {
    geoRef.current = geo
    const road = roadRef.current
    // jsdom (tests) has no SVG geometry; the page still renders, just without a truck.
    if (!geo || !road || typeof road.getTotalLength !== 'function') return

    const total = road.getTotalLength()
    const samples: RoadSample[] = []
    for (let length = 0; length < total; length += SAMPLE_STEP_PX) {
      const p = road.getPointAtLength(length)
      samples.push({ length, x: p.x, y: p.y })
    }
    const end = road.getPointAtLength(total)
    samples.push({ length: total, x: end.x, y: end.y })

    samplesRef.current = samples
    totalRef.current = total
    // Stops sit between the origin and destination anchors.
    stopLengthsRef.current = geo.points.slice(1, -1).map(p => lengthAtY(samples, p.y))
    trailRef.current?.style.setProperty('stroke-dasharray', `${total} ${total}`)
    requestTickRef.current()
  }, [geo])

  const road = geo?.desktop ? ROAD.desktop : ROAD.mobile

  return (
    <section
      ref={sectionRef}
      id={SECTIONS.journey}
      aria-labelledby="journey-heading"
      className="relative scroll-mt-16"
    >
      {geo && (
        // Sized by the section (h-full w-full), never by the measured numbers, so a layout
        // change that lands before the next measurement can't push the page longer.
        <svg
          className="pointer-events-none absolute inset-0 z-0 h-full w-full"
          viewBox={`0 0 ${geo.width} ${geo.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path ref={roadRef} d={geo.d} fill="none" className="stroke-primary" strokeWidth={road.width} strokeLinecap="round" />
          <path d={geo.d} fill="none" className={styles.roadEdge} strokeWidth={road.width - 7} strokeLinecap="round" />
          <path d={geo.d} fill="none" className="stroke-primary" strokeWidth={road.width - 10} strokeLinecap="round" />
          <path d={geo.d} fill="none" className={styles.roadLane} strokeWidth={geo.desktop ? 2 : 1.5} strokeDasharray={geo.desktop ? '16 22' : '9 13'} />
          <path ref={trailRef} d={geo.d} fill="none" className={styles.trail} strokeWidth={geo.desktop ? 3 : 2} strokeLinecap="round" />
        </svg>
      )}

      <div className="relative z-10 mx-auto max-w-[1240px] px-4 md:px-8">
        <div className="relative h-20 md:h-24">
          <span
            ref={el => { anchorRefs.current[0] = el }}
            className="absolute left-[28px] top-6 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chain-c ring-4 ring-surf md:left-1/2"
            aria-hidden="true"
          />
          <p className="absolute left-[60px] top-3 text-[0.8125rem] font-semibold text-on-surf-v md:left-[calc(50%+48px)]">
            Origin depot
          </p>
        </div>

        <div className="pb-14 pl-[60px] md:ml-[56%] md:w-[38%] md:pb-0 md:pl-0 md:pt-6">
          <h2 id="journey-heading" className="text-balance text-[min(1.875rem,8vw)] font-extrabold leading-[1.08] tracking-[-0.03em] text-on-surf md:text-[min(2.75rem,3.8vw)]">
            One truck. Seven handovers. Every one on the record.
          </h2>
          <p className="mt-4 max-w-[46ch] text-[1rem] leading-relaxed text-on-surf-v md:text-[1.0625rem]">
            Scroll to drive a sample trip from the origin depot to the receiver. Each checkpoint
            seals as the truck passes, in the same order FreightProof records a real trip.
          </p>
          <p className="mt-3 text-[0.8125rem] text-on-surf-v">Fingerprints shown here are illustrative.</p>
          <SampleRecord className="mt-8" />
        </div>

        <ol className="relative">
          {JOURNEY.map((stop, i) => {
            const nodeOnRight = i % 2 === 1
            return (
              <li
                key={stop.id}
                ref={el => { stopRefs.current[i] = el }}
                data-sealed="false"
                data-next={i === 0 ? 'true' : 'false'}
                className="relative py-8 md:flex md:min-h-[64vh] md:items-center md:py-0"
              >
                <span
                  ref={el => { anchorRefs.current[i + 1] = el }}
                  className={cn(
                    'absolute top-1/2 -translate-x-1/2 -translate-y-1/2',
                    nodeOnRight ? 'left-[34px] md:left-[80%]' : 'left-[22px] md:left-[20%]',
                  )}
                  aria-hidden="true"
                >
                  <span className={cn(styles.node, 'grid h-6 w-6 place-items-center rounded-full border-2 border-on-surf-v bg-surf-lowest md:h-8 md:w-8')}>
                    <Check className="h-3.5 w-3.5 text-chain-onc md:h-4 md:w-4" strokeWidth={3} />
                  </span>
                </span>

                <article className={cn(styles.card, 'ml-[60px] rounded-xl border border-outline-v/40 bg-surf-lowest p-6 shadow-level-2 md:ml-[28%] md:w-[44%] md:p-8')}>
                  <h3 className="text-balance text-[1.3125rem] font-bold leading-tight tracking-[-0.02em] text-on-surf md:text-[1.5625rem]">
                    {stop.title}
                  </h3>
                  <p className="mt-3 text-[0.9375rem] leading-relaxed text-on-surf-v md:text-[1rem]">{stop.body}</p>
                  <div className="mt-5 grid" aria-hidden="true">
                    <span className={cn(styles.receiptPending, '[grid-area:1/1] inline-flex items-center gap-2 self-center text-[0.8125rem] font-medium text-on-surf-v')}>
                      <span className="h-2.5 w-2.5 rounded-full border border-dashed border-on-surf-v" />
                      Waiting for the truck
                    </span>
                    <span className={cn(styles.receiptSealed, '[grid-area:1/1] flex flex-wrap items-center gap-x-2.5 gap-y-1')}>
                      <span className="inline-flex items-center gap-1.5 rounded-sm bg-chain-c px-2 py-1 text-[0.75rem] font-semibold text-chain-onc">
                        <Check className="h-3 w-3" strokeWidth={3} />
                        {stop.sealed}
                      </span>
                      <span className="hidden whitespace-nowrap text-[0.7812rem] font-medium tabular-nums tracking-[0.04em] text-chain min-[420px]:inline">
                        {SAMPLE_HASHES[i]}
                      </span>
                    </span>
                  </div>
                  <p className="sr-only">Recorded and anchored: {stop.sealed}.</p>
                </article>
              </li>
            )
          })}
        </ol>

        <div className="relative pb-24 pt-6 md:pb-36">
          <span
            ref={el => { anchorRefs.current[JOURNEY.length + 1] = el }}
            className="absolute left-[28px] top-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chain-c ring-4 ring-surf md:left-1/2"
            aria-hidden="true"
          />
          <div className="pl-[60px] pt-24 md:pl-0 md:pt-32 md:text-center">
            <p className="text-balance text-[min(1.875rem,9vw)] font-extrabold leading-[1.08] tracking-[-0.03em] text-on-surf md:text-[min(3rem,4.5vw)]">
              Delivered, and provable.
            </p>
            <p className="mt-4 max-w-[52ch] text-[1rem] leading-relaxed text-on-surf-v md:mx-auto md:text-[1.0625rem]">
              Seven records form one unbroken chain. If anyone edits a record afterwards, its
              fingerprint no longer matches the one on the public ledger, and that’s visible to anyone who checks.
            </p>
          </div>
        </div>
      </div>

      {geo && (
        // overflow-visible: parked at the origin, the trailer reaches up into the hero.
        <svg
          className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
          viewBox={`0 0 ${geo.width} ${geo.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <g ref={truckRef}>
            <Truck />
          </g>
        </svg>
      )}
    </section>
  )
}
