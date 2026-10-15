// iOS text styles (Large Title … Caption 1), expressed in rem against Body. On an iPhone,
// globals.css binds 1rem to the driver's Dynamic Type setting, so every role below scales
// with Settings › Display & Brightness › Text Size the way a native app does; elsewhere
// 1rem stays the browser's 16px and the ratios hold.
//
// Ratios are Apple's default-size points ÷ 17 (Body). No letter-spacing on purpose:
// CoreText applies SF's own size-specific tracking to the system face. Caption 2 (11pt)
// is deliberately absent — it sits on the HIG's 11pt floor and would fall below it on a
// 16px Android root.
//
// Lives here rather than inline in tailwind.config.ts because lib/utils.ts must teach
// tailwind-merge the same names: an unregistered `text-body` is read as a text COLOUR and
// silently deletes the real colour class it is merged with.
/** A Tailwind fontSize entry: the size, plus the leading (and weight) that travel with it. */
export type TypeRoleSpec = [size: string, metrics: { lineHeight: string; fontWeight?: string }]

export const TYPE_SCALE = {
  'large-title': ['2rem',    { lineHeight: '1.2',  fontWeight: '700' }],
  'title-1':     ['1.65rem', { lineHeight: '1.2',  fontWeight: '700' }],
  'title-2':     ['1.3rem',  { lineHeight: '1.25', fontWeight: '700' }],
  'title-3':     ['1.18rem', { lineHeight: '1.25', fontWeight: '600' }],
  headline:      ['1rem',    { lineHeight: '1.3',  fontWeight: '600' }],
  body:          ['1rem',    { lineHeight: '1.3' }],
  callout:       ['0.94rem', { lineHeight: '1.3' }],
  subhead:       ['0.88rem', { lineHeight: '1.3' }],
  footnote:      ['0.76rem', { lineHeight: '1.35' }],
  caption:       ['0.71rem', { lineHeight: '1.35' }],
} satisfies Record<string, TypeRoleSpec>

export const TYPE_ROLES = Object.keys(TYPE_SCALE) as (keyof typeof TYPE_SCALE)[]
