// InfoPopover (components/analytics/fleet) opens its panel from the button's left edge, capped at 280px, and is shared
// with analytics, so it is not edited for a use at the right edge of a card. Wrap it in a span with this class string
// instead: the popover's root becomes static so the nearest positioned ancestor (give the row `relative`) is the
// positioning parent, the panel opens leftwards from that row's right edge, and its width is capped to the viewport
// minus the page shell's gutters. z-30 clears a sticky toolbar (z-20) below the row.
export const POPOVER_ANCHOR_END = [
  '[&>span]:static',
  '[&_[role=region]]:left-auto',
  '[&_[role=region]]:right-0',
  '[&_[role=region]]:z-30',
  '[&_[role=region]]:max-w-[min(280px,calc(100vw-4rem))]',
].join(' ')
