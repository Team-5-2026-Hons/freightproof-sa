// Design token hex values as typed constants.
// Used in recharts configs and SVG elements that cannot reference Tailwind classes.
// Source of truth: frontend/DESIGN_SYSTEM.md §2.2
export const TOKENS = {
  primary:             '#000000',
  primaryContainer:    '#1b1b1c',
  onPrimary:           '#ffffff',
  onPrimaryContainer:  '#858384',

  secondary:              '#0051d5',
  secondaryContainer:     '#316bf3',
  onSecondary:            '#ffffff',
  onSecondaryContainer:   '#fefcff',
  secondaryFixed:         '#dbe1ff',
  secondaryFixedDim:      '#b4c5ff',

  tertiary:              '#b87500',
  tertiaryContainer:     '#ffddb8',
  onTertiary:            '#ffffff',
  onTertiaryContainer:   '#2a1700',
  tertiaryFixedDim:      '#ffb95f',

  success:              '#1a7c3e',
  successContainer:     '#c8f2d9',
  onSuccess:            '#ffffff',
  onSuccessContainer:   '#0a3d1f',

  error:              '#ba1a1a',
  errorContainer:     '#ffdad6',
  onError:            '#ffffff',
  onErrorContainer:   '#93000a',

  surface:                  '#fcf8f9',
  surfaceContainerLowest:   '#ffffff',
  surfaceContainerLow:      '#f6f3f4',
  surfaceContainer:         '#f0edee',
  surfaceContainerHigh:     '#eae7e8',
  surfaceContainerHighest:  '#e5e2e3',
  surfaceDim:               '#dcd9da',
  onSurface:                '#1b1b1c',
  onSurfaceVariant:         '#46474a',

  outline:        '#76777b',
  outlineVariant: '#c7c6ca',
} as const

export type TokenKey = keyof typeof TOKENS
