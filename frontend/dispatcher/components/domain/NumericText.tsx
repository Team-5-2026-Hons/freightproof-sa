import type { ReactNode } from 'react'

export const NUMERIC_VALUE = 'font-semibold tabular-nums tracking-[0.03em]'

const VALUE_TOKEN = /([\w-]*\d[\w-]*)/g

interface Props {
  text: string
}

/** A sentence in which only the value tokens carry the numeric rule, so a line that mixes words
 *  and values (a seal number inside "Sealed FP-3456 at departure") is not set wholly in bold. */
export function NumericText({ text }: Props) {
  const parts: ReactNode[] = text.split(VALUE_TOKEN).map((part, index) =>
    index % 2 === 1 ? <span key={index} className={NUMERIC_VALUE}>{part}</span> : part)
  return <>{parts}</>
}
