import { describe, expect, it } from 'vitest'
import { TRIP_HELP, type TripHelpTopic } from './trip-help-copy'

const TOPICS: readonly TripHelpTopic[] = ['header', 'timeline', 'info', 'cargo', 'exceptions']

// Words that would claim something the record cannot support, or name a system the dispatcher
// does not need to know about. A copy edit that introduces one should fail here, not in review.
const FORBIDDEN = /parcel perfect|blockchain|hedera|stolen|theft|\blost\b/i

describe('trip help copy', () => {
  it('has an entry for each of the five sections', () => {
    expect(Object.keys(TRIP_HELP).sort()).toEqual([...TOPICS].sort())
  })

  it.each(TOPICS)('%s: a label, a question and a basis, each non-empty', topic => {
    const entry = TRIP_HELP[topic]

    expect(entry.label.trim()).not.toBe('')
    expect(entry.question.trim()).not.toBe('')
    expect(entry.basis.trim()).not.toBe('')
  })

  it.each(TOPICS)('%s: makes no claim about cargo and names no back-end system', topic => {
    const entry = TRIP_HELP[topic]
    const text = [entry.label, entry.question, entry.basis, entry.note, entry.footnote].join(' ')

    expect(text).not.toMatch(FORBIDDEN)
  })

  it('says a missing record is a gap, not proof, and that positions are not parcel GPS', () => {
    const timeline = [TRIP_HELP.timeline.note, TRIP_HELP.timeline.footnote].join(' ')

    expect(timeline).toMatch(/gap in the record, not proof/)
    expect(timeline).toMatch(/not parcel GPS/)
  })

  it('says an exception does not describe what happened to the cargo', () => {
    expect(TRIP_HELP.exceptions.basis).toMatch(/does not say what happened to the cargo/)
  })
})
