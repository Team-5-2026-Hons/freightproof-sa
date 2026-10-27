// Z-index scale — always reference these constants, never hardcode z-index values in components.
// See DESIGN_SYSTEM.md §8.

export const Z = {
  base:    0,
  raised:  10,
  sticky:  20,
  overlay: 40,
  modal:   60,
  toast:   80,
  panic:   100,
} as const

export type ZLevel = keyof typeof Z
