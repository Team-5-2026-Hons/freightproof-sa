import { describe, expect, it } from 'vitest'

import { answerBlocks, inlineParts } from './answerFormat'

describe('answerBlocks', () => {
  it('splits paragraphs at blank lines and keeps a single line break inside one', () => {
    expect(answerBlocks('On-time arrivals fell.\nOctober is still running.\n\nAsk about one lane for more.')).toEqual([
      { kind: 'paragraph', lines: ['On-time arrivals fell.', 'October is still running.'] },
      { kind: 'paragraph', lines: ['Ask about one lane for more.'] },
    ])
  })

  it('reads "- " lines as a bulleted list, even straight after a sentence', () => {
    // 21 Oct: "- There are 4 live trips" showed as a plain hyphen in the panel.
    expect(answerBlocks('From the headline figures:\n- There are 4 live trips.\n- 1 critical problem is waiting.')).toEqual([
      { kind: 'paragraph', lines: ['From the headline figures:'] },
      { kind: 'bullets', items: ['There are 4 live trips.', '1 critical problem is waiting.'] },
    ])
  })

  it('accepts * and • bullets, and numbered lists with . or )', () => {
    expect(answerBlocks('* Seal mismatch\n• GPS mismatch')).toEqual([{ kind: 'bullets', items: ['Seal mismatch', 'GPS mismatch'] }])
    expect(answerBlocks('1. Activation\n2) Loading')).toEqual([{ kind: 'numbered', items: ['Activation', 'Loading'] }])
  })

  it('carries an indented line on with the item above it, and starts a paragraph after a list', () => {
    expect(answerBlocks('- Cape Town to Johannesburg:\n   17 problems per trip\nThat lane needs a look.')).toEqual([
      { kind: 'bullets', items: ['Cape Town to Johannesburg: 17 problems per trip'] },
      { kind: 'paragraph', lines: ['That lane needs a look.'] },
    ])
  })

  it('leaves a hyphen inside a sentence, or a negative number, alone', () => {
    expect(answerBlocks('Driver-vehicle separation was -2 on last week.')).toEqual([
      { kind: 'paragraph', lines: ['Driver-vehicle separation was -2 on last week.'] },
    ])
  })
})

describe('inlineParts', () => {
  it('shows **marked** text bold without its asterisks', () => {
    expect(inlineParts('Delay cost was **R 305 781**, the highest.')).toEqual([
      { text: 'Delay cost was ', strong: false },
      { text: 'R 305 781', strong: true },
      { text: ', the highest.', strong: false },
    ])
  })

  it('keeps unpaired asterisks as typed', () => {
    expect(inlineParts('5 * 3 trips')).toEqual([{ text: '5 * 3 trips', strong: false }])
  })
})
