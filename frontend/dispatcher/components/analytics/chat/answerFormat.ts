// Turns an answer's plain text into paragraphs and lists, so a long answer can be scanned (Tom,
// 21 Oct). The model is asked for plain text with "- " list lines (backend prompt.py). Only the
// shape is read here: every piece stays text, rendered by React as text, never as HTML, because
// an answer comes from a model and may contain anything.

export type AnswerBlock =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbered'; items: string[] }

export interface InlinePart {
  text: string
  strong: boolean
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d{1,2}[.)]\s+(.*)$/
const CONTINUATION = /^\s{2,}\S/
const STRONG = /\*\*(.+?)\*\*/g

/** The answer as blocks: a blank line ends a paragraph; "- ", "* " and "• " lines make a bulleted
 *  list, "1. " and "1) " lines a numbered one. */
export function answerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = []
  const last = (): AnswerBlock | undefined => blocks[blocks.length - 1]
  let open = false

  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      open = false
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet === null ? NUMBERED.exec(line) : null
    const current = last()
    if (bullet !== null || numbered !== null) {
      const kind = bullet !== null ? 'bullets' : 'numbered'
      const item = (bullet ?? numbered)?.[1] ?? ''
      if (current?.kind === kind) current.items.push(item)
      else blocks.push({ kind, items: [item] })
    } else if (open && current !== undefined && current.kind !== 'paragraph' && CONTINUATION.test(line)) {
      current.items[current.items.length - 1] += ` ${line.trim()}`
    } else if (open && current?.kind === 'paragraph') {
      current.lines.push(line.trim())
    } else {
      blocks.push({ kind: 'paragraph', lines: [line.trim()] })
    }
    open = true
  }
  return blocks
}

/** One line's text, with **bold** spans picked out. Unpaired asterisks stay as typed. */
export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  let from = 0
  for (const match of text.matchAll(STRONG)) {
    if (match.index > from) parts.push({ text: text.slice(from, match.index), strong: false })
    parts.push({ text: match[1], strong: true })
    from = match.index + match[0].length
  }
  if (from < text.length) parts.push({ text: text.slice(from), strong: false })
  return parts
}
