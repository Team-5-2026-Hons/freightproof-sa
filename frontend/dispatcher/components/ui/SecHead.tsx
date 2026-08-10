interface SecHeadProps {
  title: string
  /** Label for the optional action button on the right. */
  action?: string
  onAction?: () => void
}

export function SecHead({ title, action, onAction }: SecHeadProps) {
  return (
    <div className="flex items-center px-6 py-[10px] bg-surf-low shrink-0">
      <span className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
        {title}
      </span>
      {action && (
        <button
          onClick={onAction}
          style={{ background: 'linear-gradient(135deg,#1b1b1c 0%,#303031 100%)' }}
          className="ml-auto flex items-center gap-[5px] text-white text-[13px] font-[600] rounded-md px-4 py-[6px] cursor-pointer transition-all hover:brightness-[1.12] active:scale-[0.97]"
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
