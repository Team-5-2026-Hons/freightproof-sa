import { Ic, type IconName } from '@/components/ui/Ic'
import type { PhaseVerdict } from '@/lib/phase/verdict'
import { NumericText } from './NumericText'

interface Props {
  verdict: PhaseVerdict
}

type Tone = 'ok' | 'warn' | 'neutral' | 'sec'

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  neutral: 'text-on-surf-v',
  sec: 'text-sec',
}

interface Presentation {
  icon: IconName
  tone: Tone
}

/** Icon and tone per outcome. The reviewed tick is keyed on the verdict's own `reviewed` flag, not
 *  on its words: a phase whose exceptions were merely recorded has outcome `reviewed` but nobody
 *  reviewed anything. The word is always beside the icon: colour never carries the outcome alone. */
function presentationOf(verdict: PhaseVerdict): Presentation {
  switch (verdict.outcome) {
    case 'attention': return { icon: 'warn', tone: 'warn' }
    case 'reviewed':
      return verdict.reviewed
        ? { icon: 'check', tone: 'warn' }
        : { icon: 'eye', tone: 'neutral' }
    case 'clean': return { icon: 'check', tone: 'ok' }
    case 'unverified': return { icon: 'eye', tone: 'neutral' }
    case 'overridden': return { icon: 'shield', tone: 'sec' }
    case 'in_progress':
    case 'current': return { icon: 'clock', tone: 'sec' }
  }
}

/** One line answering "did this phase go cleanly?": icon, outcome word, then its reasons. */
export function PhaseVerdictLine({ verdict }: Props) {
  const { icon, tone } = presentationOf(verdict)
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-body" data-outcome={verdict.outcome}>
      <span data-verdict-icon={icon} className={`mt-[2px] shrink-0 ${TONE_TEXT[tone]}`}>
        <Ic n={icon} s={14} />
      </span>
      <span className="min-w-0">
        <span className={`font-bold ${TONE_TEXT[tone]}`}>{verdict.headline}</span>
        {verdict.reasons.length > 0 && <span className="text-on-surf-v"> · <NumericText text={verdict.reasons.join(' · ')} /></span>}
      </span>
    </p>
  )
}
