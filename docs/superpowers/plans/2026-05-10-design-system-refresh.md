# Design System Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Industrial Brutalism design system with the clean modern aesthetic from the approved mockups — soft ambient shadows, rounded corners, blue accent (#0051d5), glassmorphism navigation, Inter font throughout, Lucide icons retained.

**Architecture:** Two-phase replacement. Phase 1 updates the foundation (DESIGN_SYSTEM.md, Tailwind configs, font loading, shared tokens). Phase 2 rebuilds all UI primitive components in both surfaces. No page files, context, hooks, mocks, or types change — only visual implementation.

**Key references:**
- Mockup HTML (Trip Assignment, P1–P6) — visual source of truth
- `docs/FreightProof_Frontend_Spec_v1.md §5.1` — component prop interfaces (unchanged)
- `frontend/DESIGN_SYSTEM.md` — will be fully replaced

**Tech stack:** Next.js 15, Tailwind v3.4, TypeScript 5.5, Lucide React, Inter (next/font/google), `@shared/lib/utils/cn` path alias available in both surfaces.

---

## File Map

### Modified
| File | Change |
|---|---|
| `frontend/DESIGN_SYSTEM.md` | Full rewrite — new aesthetic |
| `frontend/shared/lib/tokens.ts` | New hex values to match new palette |
| `frontend/dispatcher/tailwind.config.ts` | New colors, radius, fonts, shadow utilities |
| `frontend/driver-pwa/tailwind.config.ts` | Identical to dispatcher |
| `frontend/dispatcher/app/globals.css` | Inter, blue focus ring, glass utility, remove hard shadows |
| `frontend/driver-pwa/app/globals.css` | Same + `pb-safe` safe-area utility |
| `frontend/dispatcher/app/layout.tsx` | Switch to Inter via next/font/google |
| `frontend/driver-pwa/app/layout.tsx` | Switch to Inter via next/font/google |

### Rebuilt (dispatcher/components/ui/)
Button · Card · Chip · DataTable · DateRangePicker · Drawer · EmptyState · IconButton · Input · Modal · Skeleton · Spinner · Tabs · TextArea · Toast

### Rebuilt (driver-pwa/components/ui/)
Same 15 minus DataTable and DateRangePicker = 13 components

---

## Task 1: Rewrite DESIGN_SYSTEM.md

**Files:**
- Modify: `frontend/DESIGN_SYSTEM.md`

- [ ] Replace the entire contents of `frontend/DESIGN_SYSTEM.md` with:

```markdown
# FreightProof SA — Design System

**"The Digital Evidence Chain"**
Clean authority. Every screen is a verified record — precise, readable, and trustworthy.

| Surface | Stack | Context |
|---|---|---|
| **Dispatcher Portal** | Next.js 15, Tailwind, TypeScript | Desktop / tablet |
| **Driver PWA** | Next.js 15 + Capacitor + @serwist/next | Android mobile |

---

## 1. Creative Direction

FreightProof is a tamper-proof evidence platform. The UI must feel authoritative and precise — like a quality logistics application a driver, dispatcher, and insurer all trust.

**Register:** Clean, professional, modern. Confident but not aggressive. Evidence should feel verified, not intimidating.

**In practice:**
- Soft ambient shadows separate layers. No hard offset shadows anywhere.
- Rounded corners (8px cards, 12px pills) — approachable and modern
- Blue accent (#0051d5) signals verified, active, and trusted states
- Glassmorphism on headers and navigation bars feels native on Android
- Inter throughout — legible at all weights from 400–900

---

## 2. Colour System

### 2.1 Design Rules

**Ambient Rule:** Elevation via `shadow-ambient` (soft, large-radius). Never hard offset shadows (`4px 4px 0 #000`).

**Glass Rule:** Sticky headers and bottom nav bars use `.glass-nav` (backdrop blur + translucent bg). Cards and content are always 100% opaque.

**Blue Accent Rule:** `secondary` (#0051d5) signals active, verified, and interactive. Use `bg-secondary/10 text-secondary` for tinted badge states.

**Error Rule:** `error` (#ba1a1a) and `error-container` (#ffdad6) for seal breaches, mismatches, and critical failures. Never used decoratively.

**Token Rule:** No raw hex in component code. Reference Tailwind classes from the token map. Raw hex only in `tailwind.config.ts` and `shared/lib/tokens.ts`.

### 2.2 Token Table

#### Primary — Tarmac Black
| Token | Hex | Usage |
|---|---|---|
| `primary` | `#000000` | Primary CTAs, sidebar, strong headings |
| `on-primary` | `#ffffff` | Text/icons on primary background |
| `primary-container` | `#1b1b1c` | Dark surface depth |
| `on-primary-container` | `#858384` | Text on primary-container |

#### Secondary — Trust Blue
| Token | Hex | Usage |
|---|---|---|
| `secondary` | `#0051d5` | Active nav, verified states, CTA links, interactive |
| `on-secondary` | `#ffffff` | Text on secondary background |
| `secondary-container` | `#316bf3` | Filled secondary elements |
| `on-secondary-container` | `#fefcff` | Text on secondary-container |
| `secondary-fixed` | `#dbe1ff` | Selected/highlighted chip background |
| `secondary-fixed-dim` | `#b4c5ff` | Dimmed secondary surface |

#### Tertiary — Amber Warning
| Token | Hex | Usage |
|---|---|---|
| `tertiary` | `#b87500` | Warning text on light surfaces |
| `on-tertiary` | `#ffffff` | Text on tertiary background |
| `tertiary-container` | `#ffddb8` | Warning badge background |
| `on-tertiary-container` | `#2a1700` | Text on tertiary-container |
| `tertiary-fixed-dim` | `#ffb95f` | In-progress pulse, amber icons |

#### Success — Verified Green
| Token | Hex | Usage |
|---|---|---|
| `success` | `#1a7c3e` | Seal intact, handshake complete, blockchain anchored |
| `on-success` | `#ffffff` | Text on success background |
| `success-container` | `#c8f2d9` | Success badge background |
| `on-success-container` | `#0a3d1f` | Text on success-container |

#### Error — Alert Red
| Token | Hex | Usage |
|---|---|---|
| `error` | `#ba1a1a` | Seal broken, mismatch, driver panic |
| `on-error` | `#ffffff` | Text on error background |
| `error-container` | `#ffdad6` | Error banner background |
| `on-error-container` | `#93000a` | Text on error-container |

#### Surface Hierarchy
| Token | Hex | Layer |
|---|---|---|
| `surface` | `#fcf8f9` | Page background |
| `surface-container-lowest` | `#ffffff` | Primary cards |
| `surface-container-low` | `#f6f3f4` | Section groups, panels |
| `surface-container` | `#f0edee` | Mid layer |
| `surface-container-high` | `#eae7e8` | Pressed states, hover |
| `surface-container-highest` | `#e5e2e3` | Inactive content, backgrounded |
| `surface-dim` | `#dcd9da` | Progress tracks, dividers |
| `on-surface` | `#1b1b1c` | Default text |
| `on-surface-variant` | `#46474a` | Secondary text, metadata |

#### Outline
| Token | Hex | Usage |
|---|---|---|
| `outline` | `#76777b` | Subtle borders, dividers |
| `outline-variant` | `#c7c6ca` | Ghost borders, separators |

### 2.3 Tailwind Config Extension

Add to `theme.extend` in both `tailwind.config.ts` files:

```ts
colors: {
  primary: {
    DEFAULT: '#000000',
    container: '#1b1b1c',
    'on': '#ffffff',
    'on-container': '#858384',
  },
  secondary: {
    DEFAULT: '#0051d5',
    container: '#316bf3',
    'on': '#ffffff',
    'on-container': '#fefcff',
    fixed: '#dbe1ff',
    'fixed-dim': '#b4c5ff',
  },
  tertiary: {
    DEFAULT: '#b87500',
    container: '#ffddb8',
    'on': '#ffffff',
    'on-container': '#2a1700',
    'fixed-dim': '#ffb95f',
  },
  success: {
    DEFAULT: '#1a7c3e',
    container: '#c8f2d9',
    'on': '#ffffff',
    'on-container': '#0a3d1f',
  },
  error: {
    DEFAULT: '#ba1a1a',
    container: '#ffdad6',
    'on': '#ffffff',
    'on-container': '#93000a',
  },
  surface: {
    DEFAULT: '#fcf8f9',
    'container-lowest': '#ffffff',
    'container-low': '#f6f3f4',
    container: '#f0edee',
    'container-high': '#eae7e8',
    'container-highest': '#e5e2e3',
    dim: '#dcd9da',
    'on': '#1b1b1c',
    'on-variant': '#46474a',
  },
  outline: {
    DEFAULT: '#76777b',
    variant: '#c7c6ca',
  },
},
fontFamily: {
  sans:     ['var(--font-inter)', 'system-ui', 'sans-serif'],
  mono:     ['var(--font-inter)', 'system-ui', 'sans-serif'],
  headline: ['var(--font-inter)', 'system-ui', 'sans-serif'],
  display:  ['var(--font-inter)', 'system-ui', 'sans-serif'],
  body:     ['var(--font-inter)', 'system-ui', 'sans-serif'],
  label:    ['var(--font-inter)', 'system-ui', 'sans-serif'],
},
borderRadius: {
  none:    '0px',
  sm:      '2px',
  DEFAULT: '2px',
  md:      '4px',
  lg:      '4px',
  xl:      '8px',
  '2xl':   '12px',
  full:    '12px',
},
boxShadow: {
  'ambient-sm':     '0 4px 20px rgba(27, 27, 28, 0.06)',
  'ambient':        '0 8px 40px rgba(27, 27, 28, 0.06)',
  'ambient-header': '0 8px 30px rgba(0, 0, 0, 0.06)',
  'ambient-up':     '0 -4px 24px rgba(0, 0, 0, 0.06)',
  'ambient-up-lg':  '0 -8px 40px rgba(0, 0, 0, 0.08)',
},
zIndex: {
  raised:  '10',
  sticky:  '20',
  overlay: '40',
  modal:   '60',
  toast:   '80',
  panic:   '100',
},
```

---

## 3. Typography

**Single font: Inter** — all roles, weights 400–900, loaded via `next/font/google`.

No separate monospace font. For trip IDs and codes: `font-mono tracking-[0.05em] font-bold` (Inter with tracking gives the same code-like feel).

| Role | Size | Weight | Usage |
|---|---|---|---|
| `display` | 36–57px | 900 | Hero numbers, key metrics |
| `headline-lg` | 32px | 800 | Page titles |
| `headline-md` | 28px | 700 | Section headings |
| `headline-sm` | 24px | 700 | Card titles |
| `title-lg` | 22px | 700 | Card sub-titles |
| `title-md` | 16px | 700 | List headers, labels |
| `title-sm` | 14px | 700 | Chip labels, badges |
| `body-lg` | 16px | 400 | Driver app body text |
| `body-md` | 14px | 400 | Secondary body |
| `label-lg` | 14px | 600 | Metadata labels |
| `label-md` | 12px | 600 | Secondary metadata |
| `mono-id` | 13px | 700 | Trip IDs, seal codes — Inter + `tracking-[0.05em]` |

**Rules:**
- Load Inter via `next/font/google` — not a `<link>` tag
- Minimum 16px on all input fields (prevents Android auto-zoom)
- All status labels: `uppercase tracking-wider font-bold text-xs`

---

## 4. Spacing

4pt base grid. Tailwind default spacing scale — no overrides needed.

---

## 5. Elevation & Depth

**Soft ambient shadows only.** No hard offset shadows anywhere in the codebase.

```
Page:    surface (#fcf8f9)
  └─ Card: surface-container-lowest (#ffffff)
           border-radius: 8px (rounded-xl)
           box-shadow: shadow-ambient
```

### Shadow Scale
| Class | Value | Use |
|---|---|---|
| `shadow-ambient-sm` | `0 4px 20px rgba(27,27,28,0.06)` | Compact cards, small floats |
| `shadow-ambient` | `0 8px 40px rgba(27,27,28,0.06)` | Standard cards |
| `shadow-ambient-header` | `0 8px 30px rgba(0,0,0,0.06)` | Sticky headers |
| `shadow-ambient-up` | `0 -4px 24px rgba(0,0,0,0.06)` | Bottom CTA bars |
| `shadow-ambient-up-lg` | `0 -8px 40px rgba(0,0,0,0.08)` | Bottom nav bar |

### Glassmorphism (navigation only)
```css
.glass-nav {
  background: rgba(252, 248, 249, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
```
Cards and content areas are **never** glass — always 100% opaque.

---

## 6. Border Radius

| Token | Value | Tailwind | Usage |
|---|---|---|---|
| none | 0px | `rounded-none` | Dividers, progress bars |
| sm / DEFAULT | 2px | `rounded-sm`, `rounded` | Tiny inner elements |
| md / lg | 4px | `rounded-md`, `rounded-lg` | Small inner elements, tight chips |
| xl | 8px | `rounded-xl` | **Cards, buttons, inputs, nav items** |
| 2xl / full | 12px | `rounded-2xl`, `rounded-full` | **Status pills, avatars, dots** |

---

## 7. Z-Index Scale

```ts
export const Z = {
  base: 0, raised: 10, sticky: 20, overlay: 40,
  modal: 60, toast: 80, panic: 100,
} as const
```

---

## 8. Icons

**Library:** Lucide React — unchanged. 1.5px stroke, 24px default.

| Concept | Lucide Icon | Colour |
|---|---|---|
| Handshake complete | `CheckCircle2` | `text-success` |
| Handshake in progress | `Clock` (pulsing) | `text-tertiary-fixed-dim` |
| Handshake pending | `Circle` (outline) | `text-outline` |
| Seal intact | `Lock` | `text-success` |
| Seal broken | `ShieldAlert` | `text-error` |
| Blockchain anchored | `Link2` | `text-secondary` |
| Panic / emergency | `AlertTriangle` | `text-error` |
| Photo capture | `Camera` | `text-surface-on` |
| GPS / location | `MapPin` | `text-surface-on-variant` |
| Timestamp | `Clock` | `text-secondary` |

---

## 9. Component Specifications

### 9.1 Cards
```
Background:   surface-container-lowest (#ffffff)
Radius:       rounded-xl (8px)
Shadow:       shadow-ambient
Padding:      p-5 mobile · p-6 desktop
Border:       none by default

exception variant: + border-l-4 border-error
selected variant:  bg-secondary-fixed shadow-ambient-sm
section variant:   bg-surface-container-low (no shadow, lower elevation)
```

### 9.2 Buttons
```
Primary:   bg-primary text-primary-on rounded-xl shadow-ambient hover:opacity-90 active:scale-[0.98]
Secondary: bg-surface-container-highest text-surface-on rounded-xl hover:bg-surface-container-high
Ghost:     bg-transparent text-secondary hover:bg-secondary/10 rounded-xl
Danger:    bg-error-container text-error-on-container rounded-xl shadow-ambient-sm

Driver PWA default: h-14 w-full (tall full-width touch target)
```

### 9.3 Status Chips / Badges
```
Radius:     rounded-full (12px) — always pill-shaped
Padding:    px-3 py-1
Font:       text-xs font-bold uppercase tracking-wider
Always paired with a dot or icon — never colour-only

verified:  bg-secondary/10 text-secondary
success:   bg-success-container text-success-on-container
warning:   bg-tertiary-container text-tertiary-on-container
error:     bg-error-container text-error-on-container
pending:   bg-surface-container-highest text-surface-on-variant
neutral:   bg-surface-container-highest text-surface-on
```

### 9.4 Inputs
```
Background (default):  bg-surface-container-low
Background (focused):  bg-surface-container-lowest
Focus border:          border-secondary
Radius:                rounded-xl
Label:                 Always above field, text-xs font-bold uppercase tracking-wider
Validate:              On blur, not on keystroke
Driver PWA:            min-h-[52px], correct inputMode attribute
```

### 9.5 Navigation

**Driver bottom bar:**
- `.glass-nav shadow-ambient-up-lg border-t border-outline-variant/20`
- Height: `h-16 pb-safe`
- Active item: `text-secondary` + filled Lucide icon

**Dispatcher sidebar:**
- `bg-primary text-primary-on` (unchanged black)
- Active item: `text-secondary` + blue left accent bar `3px`

---

## 10. Do's and Don'ts

### Do
- Use `shadow-ambient` for card elevation
- Use `rounded-xl` for cards, buttons, inputs; `rounded-full` for chips and pills
- Use `.glass-nav` for sticky headers and bottom nav
- Use `bg-secondary/10 text-secondary` for tinted verified states
- Use `uppercase tracking-wider font-bold text-xs` for all status labels
- Use `active:scale-[0.98] transition-all duration-200` on all interactive elements
- Use `font-mono tracking-[0.05em] font-bold` for trip IDs and codes

### Don't
- Use hard offset shadows (`box-shadow: 4px 4px 0 #000`)
- Use `rounded-none` for cards or buttons
- Use Signal Orange — secondary is now blue (#0051d5)
- Apply glassmorphism to cards or content areas
- Use raw hex values in component code
- Use `any` in TypeScript
```

- [ ] > **Suggested commit:** `docs: rewrite DESIGN_SYSTEM.md — clean modern aesthetic replaces brutalism`

---

## Task 2: Update shared/lib/tokens.ts

**Files:**
- Modify: `frontend/shared/lib/tokens.ts`

- [ ] Replace the entire contents with:

```ts
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
```

- [ ] Run `npm run type-check` inside `frontend/dispatcher`. Must pass.
- [ ] Run `npm run type-check` inside `frontend/driver-pwa`. Must pass.
- [ ] > **Suggested commit:** `feat(shared): update tokens.ts — blue accent, modern palette`

---

## Task 3: Update both tailwind.config.ts files

**Files:**
- Modify: `frontend/dispatcher/tailwind.config.ts`
- Modify: `frontend/driver-pwa/tailwind.config.ts`

- [ ] Replace `frontend/dispatcher/tailwind.config.ts` with:

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#000000',
          container: '#1b1b1c',
          'on': '#ffffff',
          'on-container': '#858384',
        },
        secondary: {
          DEFAULT: '#0051d5',
          container: '#316bf3',
          'on': '#ffffff',
          'on-container': '#fefcff',
          fixed: '#dbe1ff',
          'fixed-dim': '#b4c5ff',
        },
        tertiary: {
          DEFAULT: '#b87500',
          container: '#ffddb8',
          'on': '#ffffff',
          'on-container': '#2a1700',
          'fixed-dim': '#ffb95f',
        },
        success: {
          DEFAULT: '#1a7c3e',
          container: '#c8f2d9',
          'on': '#ffffff',
          'on-container': '#0a3d1f',
        },
        error: {
          DEFAULT: '#ba1a1a',
          container: '#ffdad6',
          'on': '#ffffff',
          'on-container': '#93000a',
        },
        surface: {
          DEFAULT: '#fcf8f9',
          'container-lowest': '#ffffff',
          'container-low': '#f6f3f4',
          container: '#f0edee',
          'container-high': '#eae7e8',
          'container-highest': '#e5e2e3',
          dim: '#dcd9da',
          'on': '#1b1b1c',
          'on-variant': '#46474a',
        },
        outline: {
          DEFAULT: '#76777b',
          variant: '#c7c6ca',
        },
      },
      fontFamily: {
        sans:     ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono:     ['var(--font-inter)', 'system-ui', 'sans-serif'],
        headline: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display:  ['var(--font-inter)', 'system-ui', 'sans-serif'],
        body:     ['var(--font-inter)', 'system-ui', 'sans-serif'],
        label:    ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        none:    '0px',
        sm:      '2px',
        DEFAULT: '2px',
        md:      '4px',
        lg:      '4px',
        xl:      '8px',
        '2xl':   '12px',
        full:    '12px',
      },
      boxShadow: {
        'ambient-sm':     '0 4px 20px rgba(27, 27, 28, 0.06)',
        'ambient':        '0 8px 40px rgba(27, 27, 28, 0.06)',
        'ambient-header': '0 8px 30px rgba(0, 0, 0, 0.06)',
        'ambient-up':     '0 -4px 24px rgba(0, 0, 0, 0.06)',
        'ambient-up-lg':  '0 -8px 40px rgba(0, 0, 0, 0.08)',
      },
      zIndex: {
        raised:  '10',
        sticky:  '20',
        overlay: '40',
        modal:   '60',
        toast:   '80',
        panic:   '100',
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] Copy the **identical** `theme.extend` block to `frontend/driver-pwa/tailwind.config.ts`. The `content` array is the same. The only difference in driver-pwa's config is the presence of the `withSerwist` wrapper from `@serwist/next` — keep that wrapper, just replace the inner `theme.extend`.

- [ ] Run `npm run lint` in `frontend/dispatcher`. Fix any errors.
- [ ] Run `npm run lint` in `frontend/driver-pwa`. Fix any errors.
- [ ] > **Suggested commit:** `feat(dispatcher,driver-pwa): update Tailwind — modern tokens, ambient shadows, Inter`

---

## Task 4: Update globals.css and layout.tsx — both surfaces

**Files:**
- Modify: `frontend/dispatcher/app/globals.css`
- Modify: `frontend/driver-pwa/app/globals.css`
- Modify: `frontend/dispatcher/app/layout.tsx`
- Modify: `frontend/driver-pwa/app/layout.tsx`

### 4a — dispatcher/app/globals.css

- [ ] Replace `frontend/dispatcher/app/globals.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer utilities {
  /* Glassmorphism for sticky headers and bottom nav only — never on cards */
  .glass-nav {
    background: rgba(252, 248, 249, 0.8);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  /* Trip IDs, seal codes — Inter with wide tracking mimics monospace feel */
  .tracking-industrial {
    letter-spacing: 0.05em;
  }
}

@layer base {
  /* Focus ring uses blue secondary token */
  :focus-visible {
    outline: 2px solid #0051d5;
    outline-offset: 2px;
    border-radius: 4px;
  }
}

/* Collapse all animation when user prefers reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 4b — driver-pwa/app/globals.css

- [ ] Replace `frontend/driver-pwa/app/globals.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer utilities {
  .glass-nav {
    background: rgba(252, 248, 249, 0.8);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .tracking-industrial {
    letter-spacing: 0.05em;
  }

  /* Android safe-area padding for bottom bar and panic button */
  .pb-safe {
    padding-bottom: env(safe-area-inset-bottom, 20px);
  }
}

@layer base {
  :focus-visible {
    outline: 2px solid #0051d5;
    outline-offset: 2px;
    border-radius: 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 4c — dispatcher/app/layout.tsx

- [ ] Replace `frontend/dispatcher/app/layout.tsx` with:

```tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/context/AuthContext'
import { ToastProvider } from '@/lib/context/ToastContext'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'FreightProof SA — Dispatcher',
  description: 'Cargo theft and disputed delivery evidence platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans bg-surface text-surface-on antialiased">
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
```

### 4d — driver-pwa/app/layout.tsx

- [ ] Replace `frontend/driver-pwa/app/layout.tsx` with:

```tsx
'use client'

import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/context/AuthContext'
import { ToastProvider } from '@/lib/context/ToastContext'

// TripProvider is wired in app/(app)/layout.tsx (Phase 1) — not here,
// because it is only needed inside the authenticated route group.

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-inter',
  display: 'swap',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans bg-surface text-surface-on antialiased min-h-dvh">
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
```

- [ ] Start `npm run dev` in `frontend/dispatcher`. Open `http://localhost:3000`. Confirm background is `#fcf8f9` and Inter is rendering (not Space Grotesk).
- [ ] Start `npm run dev` in `frontend/driver-pwa`. Open `http://localhost:3001`. Confirm same.
- [ ] > **Suggested commit:** `feat(dispatcher,driver-pwa): switch to Inter, update globals — glass/ambient system`

---

## Task 5: Rebuild Spinner and Skeleton

**Files:**
- Modify: `frontend/dispatcher/components/ui/Spinner.tsx`
- Modify: `frontend/dispatcher/components/ui/Skeleton.tsx`

### Spinner

- [ ] Replace `frontend/dispatcher/components/ui/Spinner.tsx` with:

```tsx
import { cn } from '@shared/lib/utils/cn'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-[3px]',
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block rounded-full border-surface-container-highest border-t-secondary animate-spin',
        sizeMap[size],
        className,
      )}
    />
  )
}
```

### Skeleton

- [ ] Replace `frontend/dispatcher/components/ui/Skeleton.tsx` with:

```tsx
'use client'

import { cn } from '@shared/lib/utils/cn'

interface SkeletonProps {
  variant?: 'text' | 'block' | 'card'
  lines?: number
  className?: string
}

export function Skeleton({ variant = 'block', lines = 1, className }: SkeletonProps) {
  // Shimmer animation is suppressed automatically via globals.css prefers-reduced-motion rule.
  const base = 'bg-surface-container-high animate-pulse rounded-xl'

  if (variant === 'text') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={cn(base, 'h-4', i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full')}
          />
        ))}
      </div>
    )
  }

  if (variant === 'card') {
    return (
      <div className={cn(base, 'p-5 flex flex-col gap-3', className)}>
        <div className="h-4 w-1/3 bg-surface-container-highest rounded-full" />
        <div className="h-6 w-2/3 bg-surface-container-highest rounded-full" />
        <div className="h-4 w-full bg-surface-container-highest rounded-full mt-2" />
        <div className="h-4 w-4/5 bg-surface-container-highest rounded-full" />
      </div>
    )
  }

  return <div className={cn(base, 'h-10', className)} />
}
```

- [ ] > **Suggested commit:** `feat(dispatcher): rebuild Spinner and Skeleton — modern aesthetic`

---

## Task 6: Rebuild Button and IconButton

**Files:**
- Modify: `frontend/dispatcher/components/ui/Button.tsx`
- Modify: `frontend/dispatcher/components/ui/IconButton.tsx`

### Button

- [ ] Replace `frontend/dispatcher/components/ui/Button.tsx` with:

```tsx
'use client'

import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:   'bg-primary text-primary-on shadow-ambient hover:opacity-90',
  secondary: 'bg-surface-container-highest text-surface-on hover:bg-surface-container-high',
  ghost:     'bg-transparent text-secondary hover:bg-secondary/10',
  danger:    'bg-error-container text-error-on-container shadow-ambient-sm hover:opacity-90',
}

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-4 py-2 text-xs min-h-[36px] gap-1.5',
  md: 'px-6 py-3 text-sm min-h-[44px] gap-2',
  lg: 'px-6 py-4 text-sm min-h-[52px] gap-2 w-full',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  iconLeft,
  iconRight,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-bold uppercase tracking-wider',
        'rounded-xl transition-all duration-200 active:scale-[0.98]',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  )
}
```

### IconButton

- [ ] Replace `frontend/dispatcher/components/ui/IconButton.tsx` with:

```tsx
'use client'

import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  'aria-label': string  // required — TypeScript enforces this at the call site
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = { sm: 'w-8 h-8', md: 'w-10 h-10', lg: 'w-12 h-12' }

export function IconButton({ icon, size = 'md', className, ...props }: IconButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-xl',
        'text-surface-on-variant hover:bg-surface-container-high',
        'transition-all duration-200 active:scale-95',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  )
}
```

- [ ] > **Suggested commit:** `feat(dispatcher): rebuild Button and IconButton — modern aesthetic`

---

## Task 7: Rebuild Card and EmptyState

**Files:**
- Modify: `frontend/dispatcher/components/ui/Card.tsx`
- Modify: `frontend/dispatcher/components/ui/EmptyState.tsx`

### Card

- [ ] Replace `frontend/dispatcher/components/ui/Card.tsx` with:

```tsx
import { type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface CardProps {
  variant?: 'default' | 'exception' | 'selected' | 'section'
  children: ReactNode
  className?: string
  onClick?: () => void
}

const variantClasses: Record<NonNullable<CardProps['variant']>, string> = {
  default:   'bg-surface-container-lowest shadow-ambient',
  exception: 'bg-surface-container-lowest shadow-ambient border-l-4 border-error',
  selected:  'bg-secondary-fixed shadow-ambient-sm',
  section:   'bg-surface-container-low',
}

export function Card({ variant = 'default', children, className, onClick }: CardProps) {
  const isInteractive = onClick !== undefined
  return (
    <div
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isInteractive
          ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }
          : undefined
      }
      className={cn(
        'rounded-xl p-5',
        variantClasses[variant],
        isInteractive && 'cursor-pointer hover:bg-surface-container-high transition-colors duration-150',
        className,
      )}
    >
      {children}
    </div>
  )
}
```

### EmptyState

- [ ] Replace `frontend/dispatcher/components/ui/EmptyState.tsx` with:

```tsx
import { type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  body: string
  cta?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, body, cta, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 py-16 px-6 text-center', className)}>
      <span className="text-surface-on-variant [&>svg]:w-12 [&>svg]:h-12">{icon}</span>
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-bold text-surface-on">{title}</h3>
        <p className="text-sm text-surface-on-variant max-w-xs leading-relaxed">{body}</p>
      </div>
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  )
}
```

- [ ] > **Suggested commit:** `feat(dispatcher): rebuild Card and EmptyState — modern aesthetic`

---

## Task 8: Rebuild Chip

**Files:**
- Modify: `frontend/dispatcher/components/ui/Chip.tsx`

- [ ] Replace `frontend/dispatcher/components/ui/Chip.tsx` with:

```tsx
import { type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

export type ChipKind = 'verified' | 'success' | 'warning' | 'error' | 'pending' | 'neutral' | 'overridden' | 'info'

interface ChipProps {
  kind: ChipKind
  icon?: ReactNode
  children: ReactNode
  animated?: boolean
  className?: string
}

const kindClasses: Record<ChipKind, string> = {
  verified:   'bg-secondary/10 text-secondary',
  info:       'bg-secondary/10 text-secondary',
  success:    'bg-success-container text-success-on-container',
  warning:    'bg-tertiary-container text-tertiary-on-container',
  error:      'bg-error-container text-error-on-container',
  pending:    'bg-surface-container-highest text-surface-on-variant',
  neutral:    'bg-surface-container-highest text-surface-on',
  overridden: 'bg-secondary-fixed text-secondary-on-container',
}

export function Chip({ kind, icon, children, animated = false, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1',
        'rounded-full text-xs font-bold uppercase tracking-wider',
        kindClasses[kind],
        className,
      )}
    >
      {icon ?? (
        <span
          className={cn('w-1.5 h-1.5 rounded-full bg-current opacity-70', animated && 'animate-pulse')}
        />
      )}
      {children}
    </span>
  )
}
```

- [ ] > **Suggested commit:** `feat(dispatcher): rebuild Chip — pill shape, modern palette`

---

## Task 9: Rebuild Input and TextArea

**Files:**
- Modify: `frontend/dispatcher/components/ui/Input.tsx`
- Modify: `frontend/dispatcher/components/ui/TextArea.tsx`

### Input

- [ ] Replace `frontend/dispatcher/components/ui/Input.tsx` with:

```tsx
'use client'

import { type InputHTMLAttributes, useState } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  helperText?: string
  error?: string
}

export function Input({ label, helperText, error, className, id, ...props }: InputProps) {
  const [touched, setTouched] = useState(false)
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-')
  const showError = touched && error

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-xs font-bold uppercase tracking-wider text-surface-on-variant"
      >
        {label}
      </label>
      <input
        id={inputId}
        onBlur={() => setTouched(true)}
        className={cn(
          'w-full rounded-xl px-4 py-3 text-sm font-medium text-surface-on',
          'bg-surface-container-low border border-outline-variant/30',
          'placeholder:text-surface-on-variant/50',
          'focus:outline-none focus:border-secondary focus:bg-surface-container-lowest',
          'transition-colors duration-150 min-h-[44px]',
          showError && 'border-error focus:border-error',
          className,
        )}
        {...props}
      />
      {showError ? (
        <p className="text-xs text-error font-medium">{error}</p>
      ) : helperText ? (
        <p className="text-xs text-surface-on-variant">{helperText}</p>
      ) : null}
    </div>
  )
}
```

### TextArea

- [ ] Replace `frontend/dispatcher/components/ui/TextArea.tsx` with:

```tsx
'use client'

import { type TextareaHTMLAttributes, useState } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  helperText?: string
  error?: string
}

export function TextArea({ label, helperText, error, className, id, ...props }: TextAreaProps) {
  const [touched, setTouched] = useState(false)
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-')
  const showError = touched && error

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-xs font-bold uppercase tracking-wider text-surface-on-variant"
      >
        {label}
      </label>
      <textarea
        id={inputId}
        onBlur={() => setTouched(true)}
        className={cn(
          'w-full rounded-xl px-4 py-3 text-sm font-medium text-surface-on',
          'bg-surface-container-low border border-outline-variant/30',
          'placeholder:text-surface-on-variant/50 resize-none',
          'focus:outline-none focus:border-secondary focus:bg-surface-container-lowest',
          'transition-colors duration-150 min-h-[120px]',
          showError && 'border-error focus:border-error',
          className,
        )}
        {...props}
      />
      {showError ? (
        <p className="text-xs text-error font-medium">{error}</p>
      ) : helperText ? (
        <p className="text-xs text-surface-on-variant">{helperText}</p>
      ) : null}
    </div>
  )
}
```

- [ ] > **Suggested commit:** `feat(dispatcher): rebuild Input and TextArea — modern aesthetic`

---

## Task 10: Rebuild Tabs

**Files:**
- Modify: `frontend/dispatcher/components/ui/Tabs.tsx`

- [ ] Replace `frontend/dispatcher/components/ui/Tabs.tsx` with:

```tsx
'use client'

import { type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface Tab {
  id: string
  label: string
  icon?: ReactNode
}

interface TabsProps {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
  className?: string
}

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div role="tablist" className={cn('flex gap-1 bg-surface-container-low rounded-xl p-1', className)}>
      {tabs.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg',
              'text-sm font-bold uppercase tracking-wider transition-all duration-200',
              isActive
                ? 'bg-surface-container-lowest text-surface-on shadow-ambient-sm'
                : 'text-surface-on-variant hover:text-surface-on hover:bg-surface-container',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] > **Suggested commit:** `feat(dispatcher): rebuild Tabs — modern aesthetic`

---

## Task 11: Rebuild Modal and Drawer

**Files:**
- Modify: `frontend/dispatcher/components/ui/Modal.tsx`
- Modify: `frontend/dispatcher/components/ui/Drawer.tsx`

### Modal

- [ ] Replace `frontend/dispatcher/components/ui/Modal.tsx` with:

```tsx
'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) { dialog.showModal() } else { dialog.close() }
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className={cn(
        'w-full m-auto rounded-xl bg-surface-container-lowest shadow-ambient p-0',
        'backdrop:bg-black/40',
        sizeClasses[size],
      )}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
        <h2 className="text-lg font-bold text-surface-on">{title}</h2>
        <button
          onClick={onClose}
          aria-label="Close modal"
          className="w-8 h-8 flex items-center justify-center rounded-xl text-surface-on-variant hover:bg-surface-container-low transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-6 py-5 text-sm text-surface-on leading-relaxed">{children}</div>

      {footer && (
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/20">
          {footer}
        </div>
      )}
    </dialog>
  )
}
```

### Drawer

- [ ] Replace `frontend/dispatcher/components/ui/Drawer.tsx` with:

```tsx
'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface DrawerProps {
  open: boolean
  onClose: () => void
  side?: 'left' | 'right' | 'bottom'
  children: ReactNode
  title?: string
}

const panelClasses = {
  left:   { container: 'left-0 top-0 h-full w-80',               open: 'translate-x-0',  closed: '-translate-x-full' },
  right:  { container: 'right-0 top-0 h-full w-80',              open: 'translate-x-0',  closed: 'translate-x-full'  },
  bottom: { container: 'bottom-0 left-0 w-full rounded-t-2xl max-h-[85vh]', open: 'translate-y-0', closed: 'translate-y-full' },
}

export function Drawer({ open, onClose, side = 'right', children, title }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const { container, open: openClass, closed } = panelClasses[side]

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-[40] transition-opacity duration-200"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div
        className={cn(
          'fixed bg-surface-container-lowest shadow-ambient z-[50]',
          'transition-transform duration-300 ease-out overflow-y-auto',
          container,
          open ? openClass : closed,
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
            <h2 className="text-base font-bold text-surface-on">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close drawer"
              className="w-8 h-8 flex items-center justify-center rounded-xl text-surface-on-variant hover:bg-surface-container-low transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </>
  )
}
```

- [ ] > **Suggested commit:** `feat(dispatcher): rebuild Modal and Drawer — modern aesthetic`

---

## Task 12: Rebuild Toast

**Files:**
- Modify: `frontend/dispatcher/components/ui/Toast.tsx`

- [ ] Replace `frontend/dispatcher/components/ui/Toast.tsx` with:

```tsx
'use client'

import { useEffect, type ReactNode } from 'react'
import { X, CheckCircle2, AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastData {
  id: string
  kind: ToastKind
  title: string
  body?: string
  sticky?: boolean
}

interface ToastItemProps {
  toast: ToastData
  onDismiss: (id: string) => void
}

const kindConfig: Record<ToastKind, { icon: ReactNode; accent: string; role: 'status' | 'alert' }> = {
  info:    { icon: <Info className="w-4 h-4 text-secondary shrink-0" />,      accent: 'border-secondary/20',  role: 'status' },
  success: { icon: <CheckCircle2 className="w-4 h-4 text-success shrink-0" />, accent: 'border-success/20',   role: 'status' },
  warning: { icon: <AlertTriangle className="w-4 h-4 text-tertiary shrink-0" />, accent: 'border-tertiary/20', role: 'status' },
  error:   { icon: <ShieldAlert className="w-4 h-4 text-error shrink-0" />,   accent: 'border-error/20',      role: 'alert'  },
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const { icon, accent, role } = kindConfig[toast.kind]

  // Auto-dismiss after 4 s unless sticky or error
  useEffect(() => {
    if (toast.sticky || toast.kind === 'error') return
    const timer = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast, onDismiss])

  return (
    <div
      role={role}
      className={cn(
        'flex items-start gap-3 w-full max-w-sm px-4 py-3 pr-3',
        'bg-surface-container-lowest rounded-xl shadow-ambient',
        'border border-outline-variant/20',
        accent,
      )}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-surface-on">{toast.title}</p>
        {toast.body && <p className="text-xs text-surface-on-variant mt-0.5 leading-relaxed">{toast.body}</p>}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="w-6 h-6 flex items-center justify-center rounded-lg text-surface-on-variant hover:bg-surface-container-low shrink-0 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

interface ToastViewportProps {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

// Render once inside DispatcherShell. Consumers call useToast().notify() — never render this directly.
export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-6 right-6 z-[80] flex flex-col gap-3 items-end"
    >
      {toasts.slice(0, 3).map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
```

- [ ] > **Suggested commit:** `feat(dispatcher): rebuild Toast — modern aesthetic`

---

## Task 13: Rebuild DataTable and DateRangePicker (dispatcher only)

**Files:**
- Modify: `frontend/dispatcher/components/ui/DataTable.tsx`
- Modify: `frontend/dispatcher/components/ui/DateRangePicker.tsx`

### DataTable

- [ ] Replace `frontend/dispatcher/components/ui/DataTable.tsx` with:

```tsx
import { ChevronUp, ChevronDown, PackageOpen } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import { EmptyState } from './EmptyState'

export interface Column<T> {
  key: keyof T
  label: string
  sortable?: boolean
  render?: (value: T[keyof T], row: T) => React.ReactNode
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[]
  rows: T[]
  sort?: { key: keyof T; dir: 'asc' | 'desc' }
  onSort?: (key: keyof T) => void
  empty?: { title: string; body: string }
  className?: string
}

export function DataTable<T extends Record<string, unknown>>({
  columns, rows, sort, onSort, empty, className,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<PackageOpen />}
        title={empty?.title ?? 'No results'}
        body={empty?.body ?? 'Nothing to show here yet.'}
      />
    )
  }

  return (
    <div className={cn('w-full overflow-x-auto rounded-xl shadow-ambient-sm', className)}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-surface-container-low">
            {columns.map((col) => (
              <th
                key={String(col.key)}
                scope="col"
                aria-sort={
                  sort?.key === col.key
                    ? sort.dir === 'asc' ? 'ascending' : 'descending'
                    : 'none'
                }
                onClick={() => col.sortable && onSort?.(col.key)}
                className={cn(
                  'px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-surface-on-variant',
                  'border-b border-outline-variant/20',
                  col.sortable && 'cursor-pointer select-none hover:text-surface-on',
                )}
              >
                <span className="flex items-center gap-1.5">
                  {col.label}
                  {col.sortable && sort?.key === col.key && (
                    sort.dir === 'asc'
                      ? <ChevronUp className="w-3 h-3" />
                      : <ChevronDown className="w-3 h-3" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={cn(
                'transition-colors duration-150 hover:bg-surface-container-low',
                i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/50',
              )}
            >
              {columns.map((col) => (
                <td
                  key={String(col.key)}
                  className="px-4 py-3 text-surface-on border-b border-outline-variant/10"
                >
                  {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

### DateRangePicker

- [ ] Replace `frontend/dispatcher/components/ui/DateRangePicker.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

export interface DateRange {
  from: string  // YYYY-MM-DD
  to: string
}

interface Preset { label: string; range: DateRange }

interface DateRangePickerProps {
  value: DateRange
  onChange: (range: DateRange) => void
  presets?: Preset[]
  className?: string
}

const today = new Date().toISOString().split('T')[0]

const DEFAULT_PRESETS: Preset[] = [
  { label: 'Today',       range: { from: today, to: today } },
  { label: 'Last 7 days', range: { from: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0], to: today } },
  { label: 'Last 30 days',range: { from: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0], to: today } },
]

export function DateRangePicker({ value, onChange, presets = DEFAULT_PRESETS, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className={cn('relative', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-surface-container-lowest border border-outline-variant/30 text-surface-on hover:bg-surface-container-low transition-colors shadow-ambient-sm"
      >
        <Calendar className="w-4 h-4 text-surface-on-variant" />
        <span>{value.from} → {value.to}</span>
        <ChevronDown className={cn('w-4 h-4 text-surface-on-variant transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 z-[10] bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/20 p-4 min-w-[280px]">
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => { onChange(preset.range); setOpen(false) }}
                  className="px-3 py-1 rounded-full text-xs font-bold bg-surface-container-low text-surface-on-variant hover:bg-secondary/10 hover:text-secondary transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">From</label>
              <input
                type="date"
                value={value.from}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
                className="w-full rounded-lg px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/30 text-surface-on focus:outline-none focus:border-secondary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">To</label>
              <input
                type="date"
                value={value.to}
                onChange={(e) => onChange({ ...value, to: e.target.value })}
                className="w-full rounded-lg px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/30 text-surface-on focus:outline-none focus:border-secondary"
              />
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-full py-2 rounded-xl bg-primary text-primary-on text-sm font-bold uppercase tracking-wider"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] > **Suggested commit:** `feat(dispatcher): rebuild DataTable and DateRangePicker — modern aesthetic`

---

## Task 14: Sync components to driver-pwa

**Files:**
- Modify: 13 files in `frontend/driver-pwa/components/ui/`

- [ ] Copy these 13 files verbatim from `frontend/dispatcher/components/ui/` to `frontend/driver-pwa/components/ui/`:
  - `Button.tsx`
  - `Card.tsx`
  - `Chip.tsx`
  - `Drawer.tsx`
  - `EmptyState.tsx`
  - `IconButton.tsx`
  - `Input.tsx`
  - `Modal.tsx`
  - `Skeleton.tsx`
  - `Spinner.tsx`
  - `Tabs.tsx`
  - `TextArea.tsx`
  - `Toast.tsx`

- [ ] Confirm `frontend/driver-pwa/components/ui/` does **not** contain `DataTable.tsx` or `DateRangePicker.tsx`. Delete them if present.

- [ ] Run `npm run type-check` in `frontend/driver-pwa`. Fix any errors.
- [ ] Run `npm run lint` in `frontend/driver-pwa`. Fix any errors.
- [ ] > **Suggested commit:** `feat(driver-pwa): sync rebuilt UI components from dispatcher`

---

## Task 15: Final verification

- [ ] Run `npm run type-check` in `frontend/dispatcher`. Must pass with zero errors.
- [ ] Run `npm run type-check` in `frontend/driver-pwa`. Must pass with zero errors.
- [ ] Run `npm run lint` in `frontend/dispatcher`. Must pass with zero errors.
- [ ] Run `npm run lint` in `frontend/driver-pwa`. Must pass with zero errors.
- [ ] Open `http://localhost:3000/_dev/tokens`. Confirm: blue swatches for secondary, warm surface backgrounds, Inter font, no orange anywhere.
- [ ] Open `http://localhost:3001/_dev/tokens`. Confirm same.
- [ ] > **Suggested commit:** `chore: verify design system refresh — type-check, lint green`

---

## Phase 0 done — what comes next

Once this plan is complete, Phase 1 page work can begin on both surfaces in parallel using the rebuilt component library. The driver-pwa pages (Login, Driver Home, Handshake 1–3) and dispatcher pages (Login, Active Trips, Trip Detail, Trip Creation) each have their own implementation plan.
