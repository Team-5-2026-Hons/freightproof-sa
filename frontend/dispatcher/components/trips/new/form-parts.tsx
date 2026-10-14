import type { ReactNode } from 'react'
import { Ic, type IconName } from '@/components/ui/Ic'
import { cn } from '@shared/lib/utils/cn'

// The underline field: the Material 3 filled look SearchSelect already uses. There is a
// base and one border variant per state, because cn() is a plain join (no tailwind-merge),
// so stacked border colours would leave the winner to stylesheet order.
const FIELD_BASE =
  'w-full bg-surf-low border-0 border-b-2 rounded-t-sm px-3 py-[10px] text-[14px] text-on-surf ' +
  'outline-none focus:bg-sec-c transition-all duration-150'

export function fieldClass(invalid: boolean): string {
  return cn(FIELD_BASE, invalid ? 'border-err focus:border-err' : 'border-outline-v focus:border-sec')
}

export function FormCard({ children }: { children: ReactNode }): React.JSX.Element {
  return <section className="rounded-lg bg-surf-lowest p-6 shadow-level-3">{children}</section>
}

export function CardTitle({ icon, children }: { icon: IconName; children: ReactNode }): React.JSX.Element {
  return (
    <h2 className="mb-[18px] flex items-center gap-2 text-[15px] font-[800] text-on-surf">
      <Ic n={icon} s={16} className="text-sec" />
      {children}
    </h2>
  )
}

/** With htmlFor, a real <label> for a native input. Without it, a caption for a control
 *  that names itself, such as SearchSelect's trigger button. */
export function FieldLabel(
  { htmlFor, id, required = false, children }: { htmlFor?: string; id?: string; required?: boolean; children: ReactNode },
): React.JSX.Element {
  const className = 'mb-1 block text-[12px] font-[600] text-on-surf-v'
  // The asterisk is visual. aria-hidden keeps it out of the accessible name.
  const mark = required ? <span aria-hidden="true"> *</span> : null
  return htmlFor
    ? <label htmlFor={htmlFor} className={className}>{children}{mark}</label>
    : <span id={id} className={className}>{children}{mark}</span>
}

/** Marks a value the PP manifest supplied. Neutral, not coloured: hue is reserved for
 *  status, evidence weight and chain receipts (DESIGN_SYSTEM.md §1.2). The icon and the
 *  darker text carry the emphasis instead. */
export function FromManifestTag({ children = 'From manifest' }: { children?: ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm bg-surf-high px-[6px] py-[1px] text-[10px] font-[700] uppercase tracking-[0.06em] text-on-surf">
      <Ic n="file" s={10} className="text-on-surf-v" />
      {children}
    </span>
  )
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }): React.JSX.Element {
  return <p id={id} role="alert" className="mt-1 text-[11px] font-[500] text-err">{children}</p>
}
