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
- `bg-primary text-primary-on` (black sidebar)
- Active item: `text-secondary` + blue left accent bar 3px

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
