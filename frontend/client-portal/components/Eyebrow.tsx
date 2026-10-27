import type { ReactNode } from 'react'

type EyebrowTag = 'p' | 'h4' | 'h5' | 'dt'

interface EyebrowProps {
  as?: EyebrowTag
  size?: 'micro' | 'caption'
  tone?: 'muted' | 'onDark'
  className?: string
  children: ReactNode
}

const SIZE_CLASS = { micro: 'text-micro', caption: 'text-caption' } as const
const TONE_CLASS = { muted: 'text-muted', onDark: 'text-white/60' } as const

/** The small-caps label that sits above a block of content. */
export function Eyebrow({ as: Tag = 'p', size = 'caption', tone = 'muted', className, children }: EyebrowProps) {
  const classes = [SIZE_CLASS[size], 'font-bold uppercase tracking-eyebrow', TONE_CLASS[tone], className]
  return <Tag className={classes.filter(Boolean).join(' ')}>{children}</Tag>
}
