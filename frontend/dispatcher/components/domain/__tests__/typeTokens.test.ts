import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import config from '@/tailwind.config'

// D37: new and rewritten phase-card components speak in four type tokens only. A literal size
// (`text-[11px]`) or a stock Tailwind size (`text-sm`) would quietly reintroduce the scale-less
// type this redesign removes, so this reads the files rather than trusting review.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SCANNED = [
  'components/domain/PhaseVerdictLine.tsx',
  'components/domain/ExceptionRow.tsx',
  'components/domain/ExceptionRowList.tsx',
  'components/domain/PhaseActs.tsx',
  'components/domain/PhaseActRow.tsx',
  'components/domain/EvidenceGroupRow.tsx',
  'components/domain/PhaseChecks.tsx',
  'components/domain/PhaseLocationDetails.tsx',
  'components/domain/PhaseAudit.tsx',
  'components/domain/PhaseZone.tsx',
  'components/domain/NumericText.tsx',
  'components/trips/PhaseCardBody.tsx',
  'components/trips/TimelinePhase.tsx',
  'components/trips/PhaseTimelineItem.tsx',
  'components/trips/TripTimeline.tsx',
] as const

const LITERAL_SIZE = /text-\[\d+(\.\d+)?(px|rem|em)\]/
const STOCK_SIZE = /\btext-(xs|sm|base|lg|[2-9]?xl)\b/

describe('type tokens (D37)', () => {
  it.each(SCANNED)('%s uses only text-label, text-meta, text-body and text-title', file => {
    const source = readFileSync(resolve(ROOT, file), 'utf8')

    expect(source).not.toMatch(LITERAL_SIZE)
    expect(source).not.toMatch(STOCK_SIZE)
  })

  it('defines exactly the four tokens, in rem so browser zoom scales them', () => {
    const sizes = config.theme?.extend?.fontSize as Record<string, [string, Record<string, string>]>

    expect(Object.keys(sizes).sort()).toEqual(['body', 'label', 'meta', 'title'])
    expect(sizes.label[0]).toBe('0.6875rem')
    expect(sizes.label[1]).toMatchObject({ lineHeight: '1rem', fontWeight: '600', letterSpacing: '0.04em' })
    expect(sizes.meta[0]).toBe('0.75rem')
    expect(sizes.meta[1]).toMatchObject({ lineHeight: '1rem' })
    expect(sizes.body[0]).toBe('0.8125rem')
    expect(sizes.body[1]).toMatchObject({ lineHeight: '1.125rem' })
    expect(sizes.title[0]).toBe('0.9375rem')
    expect(sizes.title[1]).toMatchObject({ lineHeight: '1.25rem', fontWeight: '700' })
  })
})
