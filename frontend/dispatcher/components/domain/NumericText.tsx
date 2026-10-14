import type { ReactNode } from 'react'

/** DESIGN_SYSTEM §5.2: anything that is an id, seal number, count or time renders at weight 600+
 *  with tabular figures and 0.03em-0.06em tracking (0.03em for table-like values). One string, so
 *  the rule has one definition. */
export const NUMERIC_VALUE = 'font-semibold tabular-nums tracking-[0.03em]'

// A value token is any run of word characters and hyphens that contains a digit: "7", "FP-7204",
// "user-42", an id. Unit words ("parcels", "h", "m") contain none, so they stay plain.
const VALUE_TOKEN = /([\w-]*\d[\w-]*)/g

interface Props {
  text: string
}

/** A sentence in which only the value tokens carry the numeric rule, so a line that mixes words
 *  and values (a seal number inside "Sealed FP-3456 at departure") is not set wholly in bold. */
export function NumericText({ text }: Props) {
  const parts: ReactNode[] = text.split(VALUE_TOKEN).map((part, index) =>
    // split with a capture group puts the matches at the odd indexes.
    index % 2 === 1 ? <span key={index} className={NUMERIC_VALUE}>{part}</span> : part)
  return <>{parts}</>
}
