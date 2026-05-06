# FreightProof SA — Design System

**"The Digital Manifest"**  
Industrial Brutalism meets Precision Engineering. Every screen is a piece of evidence.

This document is the single source of truth for all UI decisions across both MVP frontend surfaces:

| Surface | Stack | Primary Context |
|---|---|---|
| **Dispatcher Portal** | Next.js 15, Tailwind, TypeScript | Desktop / tablet, professional operations |
| **Driver PWA** | Next.js 15 + next-pwa, Tailwind, TypeScript | Mobile Android (company-issued Samsung), outdoor use |

---

## 1. Creative North Star

FreightProof is not a dashboard. It is a **tamper-proof evidence record**. The UI must feel like a high-tech tactical manifest — the kind of document a court or insurer would trust. Every design decision should ask: *does this feel like a verified, authoritative record — or does it feel like a generic SaaS app?*

**The register:** Industrial authority. Tight. Engineered. Unapologetically brutalist. Zero AI-generated slop aesthetics.

**What this means in practice:**
- Oversized monospaced IDs for trip numbers, seal codes, and blockchain hashes — stamped, not typed
- Surface depth via stark, solid offset shadows and thick borders. No blurry glassmorphism.
- Timestamps always paired with a verification icon or `secondary` colour
- `error` states are high-contrast and bold — a driver reading "SEAL BROKEN" in direct sunlight must see it instantly
- Generous breathing room inside cards — evidence should never feel cramped

---

## 2. Colour System

### 2.1 Design Rules

**Hard-Line Rule:** Use stark 1px or 2px solid `#000000` borders to separate sections. Emphasize the grid. Never rely on subtle background colour shifts alone.

**Solid State Rule:** Zero glassmorphism. No blurs. Floating components (mobile bottom nav, status toasts) use 100% opaque backgrounds with a sharp, hard offset shadow (e.g. `4px 4px 0px #000000`).

**Anti-Slop Rule:** No generic SaaS gradients. No pill-shaped buttons. UI elements must feel distinct, mechanical, and purposefully jagged.

**Signal Rule:** `secondary` (Signal Orange) is exclusively for verified digital actions — blockchain receipts, confirmed handshakes, navigation through the evidence chain. Do not use it for generic UI colour.

**Safety Rule:** Use `tertiary` (Caution Yellow) for warnings that need to be visible but not fatal.

### 2.2 Complete Token Table

All token values are defined here. No raw hex values should appear in component code — reference tokens only.

#### Primary — Tarmac (Black)

| Token | Hex | Usage |
|---|---|---|
| `primary` | `#000000` | Primary CTAs, sidebar background, strong headings |
| `on-primary` | `#ffffff` | Text/icons on primary background |
| `primary-container` | `#1A1A1A` | Dark surface depth (sidebar footer, modal headers on dark) |
| `on-primary-container` | `#F4F4F0` | Text on primary-container |

#### Secondary — Signal Orange

| Token | Hex | Usage |
|---|---|---|
| `secondary` | `#FF4F00` | Verified states, CTA links, handshake confirmed icons, active nav |
| `on-secondary` | `#ffffff` | Text/icons on secondary background |
| `secondary-container` | `#FFD2C2` | Background for selected/highlighted state chips |
| `on-secondary-container` | `#4A1700` | Text on secondary-container |

#### Tertiary — Caution Yellow

| Token | Hex | Usage |
|---|---|---|
| `tertiary` | `#E6A800` | Warning text on light surfaces |
| `on-tertiary` | `#ffffff` | Text/icons on tertiary background |
| `tertiary-container` | `#FFEB99` | Warning badge / chip background |
| `on-tertiary-container` | `#332500` | Text on tertiary-container |
| `tertiary-fixed-dim` | `#FFC200` | Safety Amber — warning icons, in-progress pulse |

#### Success — Phosphor Green

| Token | Hex | Usage |
|---|---|---|
| `success` | `#00D640` | Seal intact, handshake complete, blockchain anchored |
| `on-success` | `#00330F` | Text/icons on success background — dark green, not white (white fails on this brightness) |
| `success-container` | `#A3FFC2` | Success badge / chip background |
| `on-success-container` | `#00330F` | Text on success-container |

#### Error — Emergency Red

| Token | Hex | Usage |
|---|---|---|
| `error` | `#FF2A00` | Seal broken, mismatch, failed verification, driver panic |
| `on-error` | `#ffffff` | Text/icons on error background |
| `error-container` | `#FFC7C2` | Error banner / chip background |
| `on-error-container` | `#4A0C00` | Text on error-container |

#### Surface Hierarchy

Think of the UI as a physical stack of evidence documents. Deeper layers are lighter; actionable surfaces float above.

| Token | Hex | Layer |
|---|---|---|
| `surface` | `#EFEFE9` | Base — page background |
| `surface-container-lowest` | `#ffffff` | Actionable layer — primary cards, input fields |
| `surface-container-low` | `#E4E3DB` | Sectional layer — groups, panels, table rows (alt) |
| `surface-container` | `#D9D8CF` | Mid layer — sidebar, sub-panels |
| `surface-container-high` | `#CECDC2` | Elevated layer — pressed state, hover state |
| `surface-container-highest` | `#C3C2B6` | Focus layer — inactive / backgrounded content |
| `on-surface` | `#1A1A1A` | Default text colour (never pure `#000000` on light) |
| `on-surface-variant` | `#4D4D4D` | Secondary text, metadata, labels |

#### Outline

| Token | Hex | Usage |
|---|---|---|
| `outline` | `#000000` | Input field borders (active state accent only) |
| `outline-variant` | `#8A8A85` | Ghost borders at ≤20% opacity |

### 2.3 Tailwind Config Extension

Add this to `theme.extend.colors` in both `dispatcher/tailwind.config.ts` and `driver-pwa/tailwind.config.ts`:

```ts
colors: {
  primary: {
    DEFAULT: '#000000',
    container: '#1A1A1A',
    'on': '#ffffff',
    'on-container': '#F4F4F0',
  },
  secondary: {
    DEFAULT: '#FF4F00',
    container: '#FFD2C2',
    'on': '#ffffff',
    'on-container': '#4A1700',
  },
  tertiary: {
    DEFAULT: '#E6A800',
    container: '#FFEB99',
    'on': '#ffffff',
    'on-container': '#332500',
    'fixed-dim': '#FFC200',
  },
  success: {
    DEFAULT: '#00D640',
    container: '#A3FFC2',
    'on': '#00330F',        // dark green — white (#fff) fails contrast on this brightness
    'on-container': '#00330F',
  },
  error: {
    DEFAULT: '#FF2A00',
    container: '#FFC7C2',
    'on': '#ffffff',
    'on-container': '#4A0C00',
  },
  surface: {
    DEFAULT: '#EFEFE9',
    'container-lowest': '#ffffff',
    'container-low': '#E4E3DB',
    container: '#D9D8CF',
    'container-high': '#CECDC2',
    'container-highest': '#C3C2B6',
    'on': '#1A1A1A',
    'on-variant': '#4D4D4D',
  },
  outline: {
    DEFAULT: '#000000',
    variant: '#8A8A85',
  },
},
```

---

## 3. Typography

### 3.1 Fonts

**Primary — Space Grotesk**
Unapologetically modern, engineered, and sharply geometric. Evokes technical precision and brutalist architecture. Rejects the generic "Inter" SaaS look entirely.

```html
<!-- Add to layout.tsx head — both surfaces -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
```
**Secondary — IBM Plex Mono**
The ultimate technical monospace. Used exclusively for: trip IDs, seal codes, blockchain hashes, vehicle registration plates, and any identifier that must feel like a stamped industrial part.

```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

### 3.2 Type Scale

Base size is **16px** (prevents iOS auto-zoom on inputs; WCAG compliance).

| Role | Size | Line-height | Weight | Letter-spacing | Usage |
|---|---|---|---|---|---|
| `display-lg` | 57px / 3.563rem | 64px | 700 | -0.02em | Key metrics on dispatcher (total active trips) |
| `display-md` | 45px / 2.813rem | 52px | 700 | -0.02em | Section-level counters |
| `display-sm` | 36px / 2.25rem | 44px | 600 | -0.02em | Card-level large numbers |
| `headline-lg` | 32px / 2rem | 40px | 600 | 0 | Page titles |
| `headline-md` | 28px / 1.75rem | 36px | 600 | 0 | Section headings, Evidence Packet headers |
| `headline-sm` | 24px / 1.5rem | 32px | 600 | 0 | Sub-section headings |
| `title-lg` | 22px / 1.375rem | 28px | 600 | 0 | Card titles |
| `title-md` | 16px / 1rem | 24px | 600 | 0.01em | List headers, sidebar group labels |
| `title-sm` | 14px / 0.875rem | 20px | 600 | 0.01em | Chip labels, status badges |
| `body-lg` | 16px / 1rem | 24px | 400 | 0.03em | Primary body text — driver app flows |
| `body-md` | 14px / 0.875rem | 20px | 400 | 0.015em | Secondary body, descriptions |
| `body-sm` | 12px / 0.75rem | 16px | 400 | 0.025em | Caption text (use sparingly) |
| `label-lg` | 14px / 0.875rem | 20px | 500 | 0.006em | Metadata labels, timestamps |
| `label-md` | 12px / 0.75rem | 16px | 500 | 0.03em | Secondary metadata |
| `label-sm` | 11px / 0.688rem | 16px | 500 | 0.03em | Minimal labels (trip IDs in compact tables) |
| `mono-id` | 13px / 0.813rem | 20px | 500 | 0.05em | **IBM Plex Mono** — trip IDs, seals, hashes, plates |
| `mono-hash` | 11px / 0.688rem | 16px | 400 | 0.04em | **IBM Plex Mono** — full blockchain hash strings |

### 3.3 Typography Rules

- **Never go below 12px** for any readable text. Below that, it is decorative only.
- **Never use `#000000` text on `#ffffff` backgrounds.** Use `on-surface` (`#1A1A1A`) on surface tiers.
- **Timestamps are always `label-lg` in `secondary` colour** with a verification icon alongside — this signals "verified time," not just metadata.
- **Trip IDs, seal numbers, and blockchain hashes always use `mono-id` or `mono-hash`** — monospaced, slightly spaced, like a stamped document.
- **Line length:** Desktop body text: 65–75 characters max. Mobile body: 35–55 characters max. Never allow edge-to-edge paragraph text.

---

## 4. Spacing System

All spacing uses a **4pt base grid**. Components must only use values from this scale — no arbitrary pixel values.

| Token | Value | Tailwind | Common Use |
|---|---|---|---|
| `space-1` | 4px | `p-1`, `gap-1` | Icon-to-label gap, tight inline padding |
| `space-2` | 8px | `p-2`, `gap-2` | Chip internal padding, compact list row gap |
| `space-3` | 12px | `p-3`, `gap-3` | Input field internal padding (vertical) |
| `space-4` | 16px | `p-4`, `gap-4` | Standard card internal padding, list item height |
| `space-5` | 20px | `p-5`, `gap-5` | Section spacing within a card |
| `space-6` | 24px | `p-6`, `gap-6` | Card-to-card gap, standard section gap |
| `space-8` | 32px | `p-8`, `gap-8` | Major section gap, card external margin |
| `space-10` | 40px | `p-10`, `gap-10` | Page section separation |
| `space-12` | 48px | `p-12`, `gap-12` | Hero padding |
| `space-16` | 64px | `p-16`, `gap-16` | Full-page top padding |
| `space-20` | 80px | `p-20`, `gap-20` | Large layout gaps |

**Touch target minimum (Driver PWA):** All interactive elements must be at least **44×44px**. For small icons, extend the hit area with padding rather than enlarging the visual.

---

## 5. Elevation & Depth

Depth is achieved **exclusively through harsh, solid offset shadows** and thick borders. Zero blur.

### 5.1 The Layering Principle

Borders and shadows define the hierarchy. High contrast separates layers.

```
Page:    surface (#EFEFE9)
  └─ Card: surface-container-lowest (#FFFFFF)
           border: 2px solid #000000
           box-shadow: 4px 4px 0px #000000
```

### 5.2 Solid State Shadows (Floating Elements Only)

Reserved for components that must float above the layout: critical alerts, modals, the driver panic button, mobile bottom navigation.

```css
/* Hard shadow — floating only */
box-shadow: 6px 6px 0px #000000;
border: 2px solid #000000;
```

- Colour: `#000000`
- Blur: 0px
- Y-offset: 4px or 6px
- X-offset: 4px or 6px

### 5.3 The Flat Standard

No gradients. Dark surfaces should be entirely flat `primary` or `primary-container`. Gradients are an AI slop cliché. Keep it solid, flat, and bold.

---

## 6. Border Radius

Consistent radius values maintain the "structured, industrial" feel. Never use fully rounded shapes. Keep it extremely sharp and brutalist. Avoid the generic AI-generated "soft" aesthetic entirely.

| Token | Value | Tailwind | Usage |
|---|---|---|---|
| `radius-none` | 0px | `rounded-none` | Outer cards, panels, layout containers |
| `radius-sm` | 2px | `rounded-[2px]` | Inner elements, chips, badges |
| `radius-md` | 4px | `rounded-[4px]` | Buttons, input fields |
| `radius-lg` | 4px | `rounded-[4px]` | Modals, overlays |

---

## 7. Breakpoints

### 7.1 Dispatcher Portal (Desktop-first)

The dispatcher works at a desk or on a tablet. Design desktop-first, then ensure the layout is usable at tablet size.

| Name | Min-width | Tailwind Prefix | Target |
|---|---|---|---|
| `base` | 0px | (default) | Never targeted — dispatcher is not mobile |
| `sm` | 640px | `sm:` | Minimum tablet (landscape phone) |
| `md` | 768px | `md:` | Standard tablet portrait |
| `lg` | 1024px | `lg:` | Primary desktop target — sidebar appears |
| `xl` | 1280px | `xl:` | Wide desktop |
| `2xl` | 1440px | `2xl:` | Full workstation |

**Dispatcher layout rule:** At `lg` and above, show the full 240px sidebar. Between `md` and `lg`, collapse the sidebar to a 64px icon rail. Below `md`, switch to a top navigation bar.

### 7.2 Driver PWA (Mobile-first)

The driver uses a company-issued Samsung Android device. Design mobile-first. Landscape mode must remain fully operable (driver may glance at phone in a mount).

| Name | Min-width | Tailwind Prefix | Target |
|---|---|---|---|
| `base` | 375px | (default) | Small Android |
| `sm` | 390px | `sm:` | Standard Samsung |
| `md` | 412px | `md:` | Large Samsung (e.g. S series) |

**Driver PWA layout rule:** All critical content must sit above the fold at 375px. The bottom navigation bar and soft panic button must never be obscured by system chrome. Use `min-h-dvh` (not `min-h-screen`) to account for Android address bar.

---

## 8. Z-Index Scale

Define z-index values as constants — never hardcode them in components.

```ts
// lib/z-index.ts
export const Z = {
  base: 0,
  raised: 10,      // dropdown menus, card hover states
  sticky: 20,      // sticky table headers, sidebar
  overlay: 40,     // side drawers, slide-over panels
  modal: 60,       // modals, confirmation dialogs
  toast: 80,       // toast notifications, snackbars
  panic: 100,      // driver panic button — always on top of everything
} as const;
```

---

## 9. Icon System

**Library:** [Lucide React](https://lucide.dev) — consistent 1.5px stroke weight, clean geometry, MIT licensed. Do not mix in other icon libraries.

```bash
npm install lucide-react
```

**Size tokens:**

| Token | Size | Usage |
|---|---|---|
| `icon-xs` | 16px | Inline with `label-sm` text |
| `icon-sm` | 20px | Inline with body text, form field icons |
| `icon-md` | 24px | Default — navigation, card actions |
| `icon-lg` | 32px | Hero icons, empty state illustrations |
| `icon-xl` | 48px | Driver app full-screen step icons |

**Rules:**
- Never use emoji as icons anywhere in the system
- Always pair icon-only buttons with an `aria-label`
- All icons use `on-surface` colour by default; change colour via `currentColor` to inherit from parent
- Stroke width is always 1.5px — do not override

**Domain-specific icon assignments (use consistently):**

| Concept | Lucide Icon | Colour |
|---|---|---|
| Handshake complete / verified | `CheckCircle2` | `success` |
| Handshake in progress | `Clock` | `tertiary-fixed-dim` |
| Handshake pending | `Circle` (outline) | `outline` |
| Seal intact | `Lock` | `success` |
| Seal broken / exception | `ShieldAlert` | `error` |
| Blockchain anchored | `Link2` | `secondary` |
| Panic / emergency | `AlertTriangle` | `error` |
| Photo capture | `Camera` | `on-surface` |
| GPS / location | `MapPin` | `on-surface-variant` |
| Timestamp | `Clock` | `secondary` |
| Driver | `User` | `on-surface` |
| Vehicle (horse) | `Truck` | `on-surface` |
| Trailer | `Package` | `on-surface` |
| Exception / deviation | `AlertCircle` | `error` or `tertiary` |

---

## 10. Component Specifications

### 10.1 Cards — Evidence Packets

The core UI unit. Everything on the dispatcher and driver app is an Evidence Packet.

```
Structure:
┌─────────────────────────────────────────────┐
│ [Status chip]                  [ID / meta]  │ ← header row
│                                             │
│  [Title — headline-sm]                      │
│  [Supporting text — body-md, on-surface-    │
│   variant]                                  │
│                                             │
│  [Evidence row 1]    [Timestamp — secondary]│
│  [Evidence row 2]    [Timestamp — secondary]│
│                                             │
│  [Primary action]    [Secondary action]     │ ← footer row
└─────────────────────────────────────────────┘
```

**Rules:**
- Background: `surface-container-lowest` on `surface-container-low`
- Hard borders (2px solid `#000000`). Strict dividers.
- Corner radius: `radius-none` (0px) outer; `radius-sm` (2px) for inner elements (chips, badges)
- Padding: `space-6` (24px) all sides on desktop; `space-4` (16px) on mobile
- ID / meta text: top-right, `mono-id`, `on-surface-variant` — the manifest-style layout
- Timestamps: `label-lg`, `secondary` colour, `Clock` icon alongside

**States:**
- Default: `surface-container-lowest`
- Hover (dispatcher): `surface-container-high` background transition (150ms ease-out)
- Active exception: left border accent `error` 3px — the one exception to the no-border rule (semantic, not decorative)
- Selected: `secondary-container` background

### 10.2 The Handshake Chain

The primary progress indicator — 6 nodes (Handshakes 0–5) connected by a track.

**Track:** 2px vertical line in `outline-variant` at 30% opacity. Never a hard line.

**Node states:**

| State | Visual | Colour |
|---|---|---|
| Complete / Verified | `CheckCircle2` filled | `secondary` (#FF4F00) |
| In Progress | `Clock` with pulsing opacity animation | `tertiary-fixed-dim` (#FFC200) |
| Pending | Empty `Circle` outline | `outline` at 60% |
| Exception | `AlertCircle` filled | `error` (#FF2A00) |
| Bypassed (by dispatcher override) | `CheckCircle2` with diagonal line overlay | `on-surface-variant` |

**Pulse animation (in-progress only):**
```css
@keyframes handshake-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
animation: handshake-pulse 2s ease-in-out infinite;
```

Disable when `prefers-reduced-motion: reduce` — show static icon instead.

**Labels:** Each node label uses `title-sm` for the handshake name and `label-md` for the timestamp below it.

### 10.3 Buttons

**Primary:**
```
Background:   primary (#000000) flat color
Text:         on-primary (#ffffff), title-sm, font-weight 600
Padding:      12px 24px
Radius:       radius-md (4px)
Border:       2px solid outline (#000000) with a 2px offset shadow
Hover:        surface-container-highest (background lightens slightly)
Disabled:     opacity 40%, cursor not-allowed, non-interactive
```

**Secondary:**
```
Background:   surface-container-highest (#C3C2B6)
Text:         on-surface (#1A1A1A), title-sm
Padding:      12px 24px
Radius:       radius-md (4px)
Hover:        surface-container-high
```

**Tertiary / Ghost:**
```
Background:   transparent
Text:         secondary (#FF4F00), title-sm
No border
Hover:        secondary-container background (subtle fill)
```

**Danger:**
```
Background:   error-container (#FFC7C2)
Text:         on-error-container (#4A0C00), title-sm, font-weight 600
Padding:      12px 24px
Radius:       radius-md (4px)
Always visually separated from primary actions (use gap-6 minimum)
```

**Driver PWA — Large Touch:**
All driver-facing buttons add `min-h-[52px]` and `w-full` by default. Field use requires large, full-width targets.

### 10.4 Input Fields

```
Background (default):  surface-container-low (#E4E3DB)
Background (focused):  surface-container-lowest (#ffffff)
Bottom accent (active): 2px solid secondary (#FF4F00)
Radius:                radius-md (4px)
Padding:               12px 16px
Label:                 Always visible above field, never placeholder-only
                       label-md, on-surface-variant
Helper text:           body-sm, on-surface-variant, below the field
Error state:           border-left 3px solid error (#FF2A00) + error message
                       below field in body-sm, error colour
```

**Validation rule:** Validate on blur, not on keystroke. Show error only after the user has finished editing.

**Driver PWA:** All inputs `min-h-[52px]` minimum. Use `inputMode` attributes (e.g. `inputMode="numeric"` for seal numbers) to trigger the correct Android keyboard.

### 10.5 Status Badges / Chips

Used for trip status, exception flags, handshake state inline labels.

```
Padding:      4px 10px
Radius:       radius-sm (2px)
Font:         title-sm, font-weight 600

Verified / Complete:  success-container bg, on-success-container text
In Progress:          tertiary-container bg, on-tertiary-container text
Exception / Error:    error-container bg, on-error-container text
Pending:              surface-container-highest bg, on-surface-variant text
Overridden:           secondary-container bg, on-secondary-container text
```

Always include an icon alongside the text — never colour-only status.

### 10.6 Lists & Data Grids (Dispatcher)

**Hard 1px or 2px divider lines.** Separation methods:
1. **Row alternation:** odd rows `surface-container-lowest`, even rows `surface-container-low`
2. **Vertical rhythm:** `space-4` (16px) between list items
3. Never both — pick one per component

**Trip list row anatomy:**
```
[Status badge]  [Trip ID — mono-id]  [Driver name — body-md]
[Route — body-md, on-surface-variant]          [Timestamp — label-lg, secondary]
```

Column headers: `label-md`, `on-surface-variant`, uppercase, letter-spacing `0.08em`. This matches the original manifest-header aesthetic.

**Sortable columns:** Include `aria-sort` attribute. Use `ChevronUp` / `ChevronDown` icons (Lucide, `icon-xs`) aligned right of column label.

### 10.7 Toasts & Alerts

**Toasts (non-blocking notifications):**
```
Position:      Bottom-right (dispatcher), Bottom-center (driver PWA)
Width:         Max 400px (dispatcher), Full-width with 16px margin (driver)
Background:    surface-container-lowest at 100% opacity + 2px solid border + hard shadow (4px 4px 0px #000000)
Shadow:        Hard shadow (4px 4px 0px #000000)
Radius:        radius-none (0px)
Auto-dismiss:  4 seconds for info/success; manual dismiss only for error/exception
Announce:      aria-live="polite" for info; role="alert" for error
Stack:         Max 3 toasts visible; FIFO queue
```

**Critical Alert Banner (Exception / Seal Breach):**
```
Background:   error-container (#FFC7C2)
Left accent:  4px solid error (#FF2A00)
Icon:         ShieldAlert (error colour, icon-md)
Text:         title-sm bold for heading, body-md for detail
Must include: A clear action (View Exception / Dismiss / Override)
```

### 10.8 Empty States

Every list, table, and data view needs an empty state. Empty ≠ broken.

```
Icon:    icon-xl, on-surface-variant (relevant Lucide icon)
Title:   headline-sm, on-surface
Body:    body-md, on-surface-variant (1–2 lines explaining why it's empty)
CTA:     Primary or ghost button (if there's an action to take)
```

Examples:
- No active trips: "No active trips. Create a new trip to get started." + "Create Trip" button
- No exceptions: "No exceptions recorded on this trip." (no button — empty is good here)
- Search no results: "No trips match '[query]'. Try adjusting your filters."

### 10.9 Forms — Multi-Step (Driver PWA)

Driver handshake flows are sequential, single-focus steps — not long forms.

**Rules:**
- One action per screen in the driver app
- Always show which handshake step the driver is on (e.g. "Handshake 2 of 5 — Loading")
- Use `space-6` vertical rhythm between fields
- Show a sticky "Complete Handshake" CTA pinned above the system gesture bar (use `safe-area-inset-bottom` padding)
- Never auto-advance to the next step — always require an explicit confirm tap
- If a step requires a photo, the camera tap target must be `min-h-[80px] min-w-full` — it is the primary action

### 10.10 Modals & Drawers (Dispatcher)

```
Scrim:       rgba(0, 0, 0, 0.48) — strong enough to isolate foreground
Modal bg:    surface-container-lowest (#ffffff)
Radius:      radius-lg (4px)
Max-width:   560px (confirmation), 760px (detail view)
Header:      headline-sm, padding space-6
Body:        padding space-6, body-md
Footer:      padding space-4 space-6, flex row, secondary actions left / primary right
Close:       Always present — X icon top-right OR swipe-down on mobile
```

Confirm before dismissing if the modal contains unsaved input.

---

## 11. Navigation

### 11.1 Dispatcher Portal Navigation

**At `lg` and above — Persistent Sidebar:**
```
Width:        240px (expanded), 64px (icon-rail collapsed)
Background:   primary (#000000) flat color
Text:         on-primary (#ffffff)
Active item:  secondary (#FF4F00) left accent 3px + secondary-container text
Hover:        primary-container (#1A1A1A) background
Logo:         Top, 24px padding, full brand lockup
User profile: Bottom, avatar + name + role chip
```

**Primary nav items (expanded):**
```
Active Trips    (Truck icon)
Trip History    (Archive icon)
Exceptions      (AlertCircle icon) + badge count if > 0
SLA Reports     (BarChart2 icon)
Settings        (Settings icon)  ← separated from above by visual gap
```

**At `md` and below — Top Navigation Bar:**
- Top bar with logo left, hamburger right
- Drawer slides in from left (overlay at z-overlay)

### 11.2 Driver PWA Navigation

The driver app is a **linear sequential flow**, not a multi-section app. Navigation is minimal by design.

**Bottom Bar (persistent during a live trip):**
```
Background:    surface-container-lowest (#ffffff) — 100% opaque, no blur
Border-top:    2px solid #000000
Shadow:        0 -4px 0px #000000 (hard upward offset shadow)
Height:        64px + safe-area-inset-bottom
Items:         Max 3: Current Step | Trip Summary | Panic
Padding above: Content must not be obscured by this bar
```

**Panic Button:**
- Always visible, `z-panic` (100), bottom-right corner
- Red circle, `AlertTriangle` icon, `min-h-[56px] min-w-[56px]`
- Requires a 2-second hold to fire (prevents accidental activation)
- Confirmation bottom sheet before submission

**Between trips (no active handshake):** Simple home screen showing trip assignment details and a "Start Trip" CTA. No complex nav needed.

---

## 12. Charts & Data Visualisation (Dispatcher Only)

Used in the SLA Dashboard. Driver PWA has no charts.

**Recommended library:** Recharts (compatible with Next.js 15 App Router, good TypeScript support, accessible).

```bash
npm install recharts
```

**Chart Rules:**
- Every chart must have a text summary accessible via `aria-label` describing the key insight
- Provide a data table view as an alternative (toggle button)
- Use the defined colour tokens — never raw hex in chart configs
- Legend must always be visible; never below a scroll fold
- Empty chart state: "No data for this period" with `BarChart2` icon, not a broken axis
- Interactive tooltips on hover (desktop) — include exact values, not just visual position

**SLA Dashboard chart types:**

| Metric | Chart Type | Colours |
|---|---|---|
| On-time rate over time | Line chart | `secondary` line, `surface-container-low` fill |
| Exceptions by type | Horizontal bar | `error` / `tertiary-fixed-dim` / `on-surface-variant` |
| Trips per route | Grouped bar | `secondary`, `secondary-container` |
| Handshake completion rate | Donut / ring | `success`, `error`, `outline-variant` |

**Grid lines:** `outline-variant` at 40% opacity — subtle, never competes with data.

**Axis labels:** `label-sm`, `on-surface-variant`. Units always present (e.g. "Trips", "% On-time").

---

## 13. Animation & Motion

### 13.1 Duration Scale

| Name | Duration | Usage |
|---|---|---|
| `instant` | 0ms | State that requires no perceived time (checkbox tick) |
| `fast` | 100ms | Hover states, focus rings |
| `micro` | 150ms | Button press feedback, icon swaps |
| `standard` | 200ms | State transitions (badge colour change, chip update) |
| `page` | 300ms | Page transitions, card expand |
| `complex` | 400ms | Multi-element transitions (handshake chain update) |

Never exceed 400ms for any UI animation. If it takes longer, use a loading indicator instead.

### 13.2 Easing

```css
/* Entering elements */
transition-timing-function: cubic-bezier(0, 0, 0.2, 1); /* ease-out */

/* Exiting elements */
transition-timing-function: cubic-bezier(0.4, 0, 1, 1); /* ease-in */

/* State changes (enter and exit) */
transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); /* ease-in-out */
```

Exit animations should be ~60% of the enter duration to feel responsive.

### 13.3 Reduced Motion

**Always respect `prefers-reduced-motion`.**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

The Handshake Chain pulse animation must stop and show a static icon when reduced-motion is active.

### 13.4 Allowed Animations

- `transform` and `opacity` only — never animate `width`, `height`, `top`, `left`
- Loading skeletons: `surface-container-low` → `surface-container-high` shimmer (200ms ease-in-out, loop)
- Handshake pulse: 2s ease-in-out loop on `opacity` only (see §10.2)
- Toast entrance: `translateY(8px)` → `translateY(0)` + `opacity 0` → `1` (200ms ease-out)
- Card hover: `background-color` transition only (150ms ease-out)

---

## 14. Accessibility

### 14.1 Contrast Requirements

| Context | Required Ratio | Result |
|---|---|---|
| Body text (`body-md`, `body-lg`) | 4.5:1 | `on-surface` (#1A1A1A) on `surface` (#EFEFE9) → **~15:1 ✓** |
| `on-surface-variant` on `surface` | 4.5:1 | #4D4D4D on #EFEFE9 → **~5.2:1 ✓** |
| `on-success` on `success` | 4.5:1 | #00330F on #00D640 → **~6.7:1 ✓** (use dark green, not white — white is 1.9:1 ✗) |
| `error` on `error-container` | 4.5:1 | #FF2A00 on #FFC7C2 → **~2.5:1 ✗ — use `on-error-container` (#4A0C00) instead** |
| `on-error-container` on `error-container` | 4.5:1 | #4A0C00 on #FFC7C2 → **~8.1:1 ✓** |
| `secondary` (#FF4F00) as small text on `surface` | 4.5:1 | **~2.8:1 ✗ — orange fails for body text** |
| `secondary` (#FF4F00) as large text / icon on `surface` | 3:1 | **~2.8:1 ✗ — still fails even for large text** |

**`secondary` (#FF4F00) text restriction:** Signal Orange cannot be used for any text smaller than a decorative display size. It passes visually but fails WCAG at all sizes. Correct usage:
- ✓ As a background fill (e.g. active nav accent bar, status chip background)
- ✓ As a large icon colour (icon-md and above — icons are not held to the text ratio)
- ✓ As `secondary-container` fill behind dark text (`on-secondary-container`)
- ✗ Never as standalone text colour for timestamps, labels, or link text

For timestamps and clock-icon labels that previously used `secondary` as text colour: use `on-surface` text with a `secondary`-filled icon shape or pill alongside it instead.

Do not approve any new colour combination without verifying contrast. Use [Colour Contrast Analyser](https://www.tpgi.com/color-contrast-checker/) or equivalent.

### 14.2 Focus States

Every interactive element must have a visible focus ring. Do not suppress `outline` globally.

```css
/* Global focus standard */
:focus-visible {
  outline: 2px solid #FF4F00; /* secondary */
  outline-offset: 2px;
  border-radius: 4px; /* radius-sm */
}
```

### 14.3 Keyboard Navigation

- Tab order must match visual reading order
- The dispatcher sidebar must be fully keyboard navigable
- Modals must trap focus while open; restore focus to trigger element on close
- The driver panic button must be reachable via keyboard (Tab → Enter/Space)

### 14.4 Screen Reader Rules

- Icon-only buttons must have `aria-label`
- Status badges must have text — never icon + colour alone (e.g. a "Seal Broken" badge needs both the `ShieldAlert` icon and the text "Seal Broken")
- Trip timeline events should read sequentially (ordered list, not a generic div)
- Toasts: `role="status"` for info, `role="alert"` for exceptions
- Charts: `aria-label` on the chart container describing the key insight in one sentence

### 14.5 Touch Accessibility (Driver PWA)

- All tap targets ≥ 44×44px
- Minimum 8px gap between adjacent tap targets
- The panic button must be reachable with one thumb, not require a two-handed gesture
- Never require precision taps on small icons — expand hit areas with `padding` before shrinking visual size

---

## 15. Platform-Specific Rules

### 15.1 Dispatcher Portal

- **Desktop-first layout** — design for 1280px, ensure usable at 768px
- **No pinch-to-zoom disable** — `user-scalable=no` is forbidden
- **Data density is appropriate** — the dispatcher is a professional scanning many trips; compact tables are expected and welcome
- **Hover states are valid** — dispatchers use a mouse; hover can reveal secondary actions
- **Right-click context menus** — not in scope, but do not break them
- **Keyboard shortcuts** — document any added keyboard shortcuts in the UI (tooltip on hover of the relevant element)
- **Max content width:** `max-w-7xl` (1280px) centered — no full-bleed content on ultra-wide monitors

### 15.2 Driver PWA (Android)

- **Mobile-first** — never port a desktop layout to mobile
- **Offline-first thinking** — the PWA works offline on the N3 corridor where signal drops. Any action that requires network must show a clear "queued — will submit when reconnected" state rather than an error
- **One action per screen** — the driver is handling a truck; cognitive load must be minimal
- **`min-h-dvh`** — not `min-h-screen` (avoids Android address bar overlap)
- **`safe-area-inset-*`** — apply to bottom bar and panic button for notch / gesture bar clearance
- **No hover states** — touch only; no reliance on hover for critical information
- **Text size minimum 16px** on all input fields — prevents Android auto-zoom
- **`inputMode` attributes** — `numeric` for seal numbers and parcel counts; `text` for names; `tel` for OTP
- **Camera integration** — photo capture is a primary action, not a secondary. The capture button must be visually prominent (full-width, icon-xl camera icon)
- **Back navigation** — Android back gesture must never lose data silently. Confirm before dismissing a partially completed handshake step

---

## 16. Do's and Don'ts

### Do

- **Do** use `error` on `error-container` with bold `title-sm` for exceptions — a driver must read "SEAL BROKEN" in bright sunlight
- **Do** pair every timestamp with a `secondary`-coloured `Clock` icon — this signals verified time, not just metadata
- **Do** use `tertiary-fixed-dim` (#FFC200) for Safety Amber warnings — visible but not alarming
- **Do** use `mono-id` (IBM Plex Mono) for all IDs, seal codes, plates, and hashes
- **Do** use generous `space-6` (24px) internal card padding — evidence should breathe
- **Do** define all touch targets at ≥ 44×44px on the driver PWA
- **Do** show a clear offline/queued state when the driver PWA cannot reach the network
- **Do** label every navigation item with both an icon and text — icon-only nav harms discoverability
- **Do** test the dispatcher at 1280px and 768px; test the driver PWA at 375px portrait and landscape

### Don't

- **Don't** use 100% black (`#000000`) text on 100% white (`#ffffff`). Use `on-surface` on defined surface tiers
- **Don't** use `secondary` (Signal Orange) as text colour — it fails contrast at all text sizes. Use it as a fill, icon, or accent bar only
- **Don't** use rounded-full / pill shapes on buttons. `radius-md` (4px) is the maximum for actions
- **Don't** rely on soft tonal surface shifts without borders. Embrace hard lines and structural grids. It must look engineered.
- **Don't** use emoji as icons anywhere in either surface
- **Don't** put a live GPS map inside FreightProof — Pulsit owns that. Show GPS coordinates as text with timestamps
- **Don't** block the driver from progressing a handshake with a network error — queue the action offline and confirm submission when reconnected
- **Don't** animate `width`, `height`, `top`, or `left` — use `transform` and `opacity` only
- **Don't** suppress focus rings globally — accessibility is non-negotiable
- **Don't** encode raw hex colours in component code — reference design tokens

---

## 17. Quick Reference Card

| Need | Token / Rule |
|---|---|
| Page background | `surface` #EFEFE9 |
| Card background | `surface-container-lowest` #ffffff |
| Section / panel background | `surface-container-low` #E4E3DB |
| Primary text | `on-surface` #1A1A1A |
| Secondary text / metadata | `on-surface-variant` #4D4D4D |
| Verified / complete | `secondary` #FF4F00 (as fill/icon — not as text) |
| Seal intact / success | `success` #00D640 with `on-success` #00330F |
| Exception / error | `error` #FF2A00 (as fill); `on-error-container` #4A0C00 for text |
| Warning / in-progress | `tertiary-fixed-dim` #FFC200 |
| Trip ID / seal code / hash | `mono-id` IBM Plex Mono, 0.05em spacing |
| Timestamp style | `label-lg`, `on-surface` text, `secondary`-filled Clock icon alongside |
| Card padding (desktop) | `space-6` (24px) |
| Card padding (mobile) | `space-4` (16px) |
| Button radius | `radius-md` (4px) |
| Card radius | `radius-none` (0px) |
| Touch target minimum | 44×44px |
| Focus ring | 2px solid `secondary`, offset 2px |
| Icon library | Lucide React, 1.5px stroke |
| Animation max duration | 400ms |
| Easing (enter) | `cubic-bezier(0, 0, 0.2, 1)` |
| Easing (exit) | `cubic-bezier(0.4, 0, 1, 1)` |
| Panic button z-index | 100 (`Z.panic`) |
