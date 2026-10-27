import type { ReactNode } from 'react'

interface SecHeadProps {
  title: string
  info?: ReactNode
  meta?: ReactNode
  action?: string
  onAction?: () => void
}

export function SecHead({ title, info, meta, action, onAction }: SecHeadProps) {
  return (
    <div className="flex items-center px-6 py-[10px] bg-surf-low shrink-0">
      <span className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
        {title}
      </span>
      {info && <span className="relative z-30 ml-1.5 flex">{info}</span>}
      {meta && <div className="ml-auto">{meta}</div>}
      {action && (
        <button
          onClick={onAction}
          style={{ background: 'linear-gradient(135deg,#1b1b1c 0%,#303031 100%)' }}
          className={`${meta ? 'ml-4' : 'ml-auto'} flex items-center gap-[5px] text-white text-[13px] font-[600] rounded-md px-4 py-[6px] cursor-pointer transition-all hover:brightness-[1.12] active:scale-[0.97]`}
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          {action}
        </button>
      )}
    </div>
  )
}
