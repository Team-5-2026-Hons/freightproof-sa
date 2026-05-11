// Z-index scale — always reference these constants, never hardcode z-index values in components.
// See DESIGN_SYSTEM.md §8.

export const Z = {
  base:    0,
  raised:  10,   // dropdown menus, card hover states
  sticky:  20,   // sticky table headers, sidebar
  overlay: 40,   // side drawers, slide-over panels
  modal:   60,   // modals, confirmation dialogs
  toast:   80,   // toast notifications
  panic:   100,  // driver panic button — always above everything
} as const

export type ZLevel = keyof typeof Z
