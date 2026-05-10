// Design token hex values as typed constants.
// Use these where Tailwind classes are not available: recharts, SVG fills, canvas.
// Never use raw hex anywhere else — use the Tailwind token map instead.

export const TOKENS = {
  primary:                 '#000000',
  primaryContainer:        '#1A1A1A',
  onPrimary:               '#ffffff',
  onPrimaryContainer:      '#F4F4F0',

  secondary:               '#FF4F00',
  secondaryContainer:      '#FFD2C2',
  onSecondary:             '#ffffff',
  onSecondaryContainer:    '#4A1700',

  tertiary:                '#E6A800',
  tertiaryContainer:       '#FFEB99',
  onTertiary:              '#ffffff',
  onTertiaryContainer:     '#332500',
  tertiaryFixedDim:        '#FFC200',

  success:                 '#00D640',
  successContainer:        '#A3FFC2',
  onSuccess:               '#00330F',
  onSuccessContainer:      '#00330F',

  error:                   '#FF2A00',
  errorContainer:          '#FFC7C2',
  onError:                 '#ffffff',
  onErrorContainer:        '#4A0C00',

  surface:                 '#EFEFE9',
  surfaceContainerLowest:  '#ffffff',
  surfaceContainerLow:     '#E4E3DB',
  surfaceContainer:        '#D9D8CF',
  surfaceContainerHigh:    '#CECDC2',
  surfaceContainerHighest: '#C3C2B6',
  onSurface:               '#1A1A1A',
  onSurfaceVariant:        '#4D4D4D',

  outline:                 '#000000',
  outlineVariant:          '#8A8A85',
} as const

export type TokenKey = keyof typeof TOKENS
