# FreightProof SA — Design System v2

**"Evidence, Surfaced."** Material You meets evidentiary precision. Every screen exists to capture, prove, or display proof of a freight handshake. The visual language is calm, soft, neutral — the *content* (status chips, evidence tags, blockchain anchors) carries the weight.

- **Version**: 2.0 (replaces v1 "Industrial Brutalism")
- **Source of truth**: `FreightProof Hi-Fi.html`
- **Reference HTMLs**: `docs/reference/*.html` (per-screen extracts — to be split)
- **Archived**: `docs/archive/DESIGN_SYSTEM_brutalist_v1.md`

---

## 1. Foundations

### 1.1 Origin
Built on **Material Design 3 tonal roles** (surface tiers, on-X-container pattern, outline-variant), extended with three domain-specific systems:

- **Status chips** — 6 trip states (transit / loading / complete / exception / critical / pending)
- **Evidence levels** — 4 tiers of evidentiary weight per handshake (baseline → medium → high → highest)
- **Chain attestation** — a dedicated tonal palette (`chain` / `chain-container`) for anything anchored to Hedera HCS

### 1.2 Principles
1. **The page is paper, the content is the proof.** Surfaces are near-white with low-blur shadows; never compete with content.
2. **Colour is information.** Hue is reserved for status, evidence weight, and chain receipts. Decorative colour is forbidden.
3. **Numeric data is sacred.** Trip IDs, seal numbers, GPS coords, timestamps all render with `font-variant-numeric: tabular-nums` and tracked letter-spacing.
4. **Gradients earn primary actions.** Only the primary CTA uses the dark gradient (`#1b1b1c → #303031`); everything else is flat.
5. **Live = pulse.** Active timeline nodes and current stepper dots use the `pulse` keyframe (3 frames, 1.8s ease-out, infinite).

---

## 2. Colour Tokens

All tokens exist as **CSS custom properties** (`:root`) and a **JS mirror** (`const C = {...}`).

### 2.1 Surface tiers (light → dark)
| Token | Hex | Use |
|---|---|---|
| `--surf-lowest` (`surfLowest`) | `#ffffff` | Card backgrounds, modals, table rows |
| `--surf` (`surf`) | `#fcf8f9` | Main app background (right of sidebar) |
| `--surf-low` (`surfLow`) | `#f6f3f4` | Sidebar in trip detail, table-row stripe, input rest state, sticky headers |
| `--surf-high` (`surfHigh`) | `#e5e2e3` | Secondary button rest, disabled CTA, progress-bar track, pending chip |

### 2.2 Primary (ink)
| Token | Hex | Use |
|---|---|---|
| `--primary` (`primary`) | `#1b1b1c` | Sidebar bg, Trip Summary card bg, Highest evidence banner, primary button start |
| `--primary-c` (`primaryC`) | `#303031` | Primary button end (gradient stop) |
| `--on-primary` (`onPrimary`) | `#ffffff` | Text on `--primary` |

Primary button gradient: `linear-gradient(135deg, #1b1b1c 0%, #303031 100%)` with `border: 1px solid rgba(255,255,255,0.08)`.

### 2.3 Secondary (action / link / focus)
| Token | Hex | Use |
|---|---|---|
| `--sec` (`sec`) | `#0051d5` | Active nav border (3px), all link/action text, trip IDs, timestamps, active stepper dot, focused input bottom-border |
| `--sec-c` (`secC`) | `#d8e2ff` | Active input background, "transit" chip bg, secondary container fills |
| `--on-sec` | `#ffffff` | — |
| `--on-sec-c` (`onSecC`) | `#001551` | Text on `--sec-c` |

### 2.4 Status / semantic roles
| Role | Base | Container | On-Container |
|---|---|---|---|
| Error / critical | `--err` `#ba1a1a` | `--err-c` `#ffdad6` | `--on-err-c` `#410002` |
| Warning / exception | `--warn` `#805600` | `--warn-c` `#ffb95f` | `--on-warn-c` `#2b1700` |
| Success / verified | `--ok` `#006c4c` | `--ok-c` `#89f8c7` | `--on-ok-c` `#002114` |

### 2.5 Chain (blockchain attestation — domain role)
| Token | Hex | Use |
|---|---|---|
| `--chain` (`chain`) | `#006874` | `<Ic n="hex">` icon, transaction-hash text |
| `--chain-c` (`chainC`) | `#97f0ff` | `ChainTag` bg, "Blockchain" sidebar card bg |
| `--on-chain-c` (`onChainC`) | `#001f24` | Text on `--chain-c` |

### 2.6 Text & outline
| Token | Hex | Use |
|---|---|---|
| `--on-surf` (`onSurf`) | `#1b1b1c` | Primary body text, headings |
| `--on-surf-v` (`onSurfV`) | `#46464f` | Secondary text, labels, meta |
| `--outline` (`outline`) | `#777680` | Dashed-border icons, neutral dots |
| `--outline-v` (`outlineV`) | `#c7c6ca` | Input rest-state underline, pending stepper dots, table dividers (with `33` / `4d` / `66` alpha suffix) |

**Alpha hex convention**: append two-char hex alpha — `outlineV+'33'` = ~20%, `+'4d'` = 30%, `+'66'` = 40%, `+'88'` = 53%. Used for dividers, sub-dividers, and trail lines.

---

## 3. Shape & Radius

Four-step scale (Material 3 corner family, renamed):

| Token | Px | Use |
|---|---|---|
| `--r-sm` | `3px` | Chips, evidence tags, seals, input top corners |
| `--r-md` | `6px` | Buttons, nav items, small cards, chips with icon |
| `--r-lg` | `10px` | Stat cards, banners, trip-info cards, exception banners, sidebar-card content |
| `--r-xl` | `14px` | Phone container inner cards, large primary surfaces |

**Phone bezel** uses a non-token `48px` radius (device shape, not UI shape).

---

## 4. Elevation

Four levels — soft, low-blur, near-black. Never offset shadows; never harsh.

| Level | CSS | Use |
|---|---|---|
| 0 | none | Surfaces touching surface |
| 1 | `0 1px 0 rgba(27,27,28,0.06)` or `0 1px 0 var(--outline-v)33` | Top bar, mobile head, stepper bottom edge |
| 2 | `0 2px 8px rgba(27,27,28,0.04)` | Sidebar trip-info card, cargo card |
| 3 | `0 2px 12px rgba(27,27,28,0.06)` | All main cards: stat cards, exception card, table panel, SLA charts |
| 4 | `0 2px 16px rgba(27,27,28,0.08)` | Driver "Active Trip" home card |
| 5 | `0 8px 32px rgba(27,27,28,0.18)` | Floating dark summary panels (Trip Summary, Export Report sidebar) |
| 6 | `0 16px 64px rgba(0,0,0,0.5)` | App-shell dispatcher panel on `#0a0a0c` chrome |
| 7 | `0 40px 100px rgba(0,0,0,0.65), inset 0 0 0 3px #1a1a1e` | Phone device (driver PWA) |

---

## 5. Typography

**Family**: `Inter` (300/400/500/600/700/800/900). One family, no exceptions. Mono is *not* used — `font-variant-numeric: tabular-nums` + letter-spacing handles numeric alignment.

### 5.1 Roles (px / weight / letter-spacing)

| Role | Size | Weight | LS | Use |
|---|---|---|---|---|
| Display | 36 | 900 | -0.03em | 3-way count reconciliation digit (driver Unloading) |
| Headline-L | 28 | 800 | -0.03em | StatCard value |
| Headline-M | 22 | 800 | -0.01em | Driver active-trip ID (`TRP-0041`) |
| Title-L | 18 | 800 | -0.02em | TopBar title, HBanner name, "FreightProof" wordmark |
| Title-M | 17 | 800 | -0.01em | MobHead title |
| Title-S | 15 | 800 | — | Card section title ("Order Details", "Driver & Vehicle") |
| Body-L | 14 | 400–600 | — | Nav label, button label-md, table cell |
| Body-M | 13 | 400–700 | — | Default body, chip text in cards |
| Body-S | 12 | 500–700 | 0.03em | Active sub-text under TopBar title |
| Label-L | 11 | 700 | 0.1em UPPER | Section heads ("OVERVIEW", "Trip Info") |
| Label-M | 11 | 500 | 0.04em | Tabular ID display (chain hashes, order refs) |
| Label-S | 10 | 700 | 0.1em UPPER | Table column headers, evidence tag, side-card labels |
| Caption | 10 | 700 | 0.06em UPPER | "EVIDENCE PLATFORM" eyebrow under wordmark |

### 5.2 Numeric typography rule
Any element rendering an ID, hash, timestamp, GPS coord, seal number, plate, or count **MUST** apply:
```js
fontVariantNumeric: 'tabular-nums', letterSpacing: '0.03em'–'0.06em', fontWeight: 600+
```
Higher emphasis = wider letter-spacing (up to `0.06em` for Seals; `0.03em` for table cells).

---

## 6. Icon System

Custom 24×24 stroke icon set (`IP` object, 22 paths). All icons:
- viewBox `0 0 24 24`, `fill: none`
- `stroke-width: 1.75` (default), `stroke-linecap: round`, `stroke-linejoin: round`
- Multi-path glyphs separated by ` M ` in the source string; `Ic` component splits and renders each as a `<path>`

**Icon name → use**:
| Name | Glyph | Use |
|---|---|---|
| `home`, `plus`, `file`, `clock`, `bars` | Nav primitives | Sidebar |
| `warn` (triangle), `check` (circle-tick) | Status indicators | Banners, exception rows |
| `lock`, `truck`, `user`, `cam`, `box` | Domain | Seal/driver/cargo/photo capture |
| `hex` | Hexagon | **Blockchain anchor marker** — reserved exclusively for chain/Hedera references |
| `shield` | Verification badge | IDVS-verified driver, Highest evidence |
| `sat` | Satellite | GPS / Pulsit geofence reading |
| `siren` | Emergency | PANIC button |
| `back`, `chev` | Navigation | Mobile back, "View →" links |
| `map`, `eye`, `dl`, `filter`, `search` | Utility | Route picker, view, download, table filter |

Size scale used in practice: `9` (inside evidence tag), `11` (inline meta tick), `13` (button leading), `14` (timeline-event clock), `15` (sidebar nav, capture-box icon when done), `16` (banner step icon, top-bar buttons), `22` (capture-box icon when empty), `28` (driver loading hero).

---

## 7. Components

### 7.1 `Btn` — Button
**Props**: `variant` (primary/secondary/ghost/danger/success), `size` (sm/md/lg), `disabled`, `full`, `onClick`.

| Variant | Background | Text | Border |
|---|---|---|---|
| primary | `linear-gradient(135deg,#1b1b1c,#303031)` | `#fff` | `1px solid rgba(255,255,255,0.08)` |
| secondary | `--surf-high` | `--on-surf` | `1px solid rgba(199,198,202,0.2)` |
| ghost | transparent | `--sec` | none |
| danger | `--err` | `#fff` | none |
| success | `--ok` | `#fff` | none |

**Sizes**: sm `12px / 5×14`, md `14px / 9×20`, lg `15px / 13×28`. Always `font-weight:600`, `border-radius: var(--r-md)`, `gap:6` for leading icon.

**Interactions**:
- Hover: `filter: brightness(1.12)` (skipped if disabled)
- Press: `transform: scale(0.97)` then release to `none`
- Disabled: `opacity: 0.4`, `cursor: not-allowed`
- Transition: `120ms`

### 7.2 `Chip` — Status pill
6 types, all `11px / 700 / 0.03em letter-spacing / 3×10 padding / r-md radius`, with a `6×6 dot` on the left (3px gap):

| `type` | bg | text | dot |
|---|---|---|---|
| `transit` | `--sec-c` | `--on-sec-c` | `--sec` |
| `loading` | `--sec-c` | `--on-sec-c` | `--sec` |
| `complete` | `--ok-c` | `--on-ok-c` | `--ok` |
| `exception` | `--warn-c` | `--on-warn-c` | `--warn` |
| `critical` | `--err-c` | `--on-err-c` | `--err` |
| `pending` | `--surf-high` | `--on-surf-v` | `--outline-v` |

### 7.3 `EvidenceTag` — Evidence weight (domain)
The most important domain component. 4 levels, `10px / 700 / 0.06em / UPPERCASE / 2×8 padding / r-sm radius`:

| `level` | Label | bg | text | Icon |
|---|---|---|---|---|
| `baseline` | "Baseline" | `--surf-high` | `--on-surf-v` | — |
| `medium` | "Medium Evidence" | `--sec-c` | `--on-sec-c` | — |
| `high` | "High Evidence" | `--ok-c` | `--on-ok-c` | — |
| `highest` | "Highest — Primary Evidence" | `--primary` | `#fff` | `shield` (9px, white) |

**Rule**: an evidence tag is only attached to a *committed* handshake event (H1–H5). Never used for checkpoints or exceptions.

### 7.4 `Seal` — Numeric attestation
Single-line ID pill, `13px / 700 / 0.06em / tabular-nums / 3×10 padding / r-sm radius`, dark on white.
- Default: `bg: --primary, color: #fff`
- `mismatch={true}`: `bg: --err, color: #fff` (used in destination gate-in seal-mismatch state)

### 7.5 `GPS` — Geofence reading
Compact horizontal pill: `--surf-low` bg, `r-sm`, `7×12 padding`, `12 mb`. Contains:
- `sat` icon (13px, `--ok` if `ok!==false`, `--warn` otherwise)
- Source label: `10px / 700 / 0.06em UPPER`, colour-matched to satellite (e.g. "Pulsit geofence ✓" or "Pulsit geofence !")
- Coord text: `11px / tabular-nums / --on-surf-v`

### 7.6 `ChainTag` — Blockchain receipt marker
Inline-flex pill: `--chain-c` bg, `r-sm`, `5×10 padding`, `6px top margin`. Contains:
- `hex` icon (12px, `--chain`)
- Text: `11px / 500 / 0.04em / tabular-nums / --on-chain-c` — typically Hedera TXN ID

**Rule**: a ChainTag is *only* attached to events that have been anchored. Checkpoints get a single batch ChainTag explaining "batch-anchored daily" rather than per-checkpoint tags.

### 7.7 `CaptureBox` — Photo evidence drop zone
Stateful component (internal `useState(initDone)`). Click toggles to "captured" state.
- **Empty**: `2px dashed --outline-v`, `--surf-low` bg, icon at 22px in `--outline`, text "Tap to photograph {label}"
- **Done**: `2px solid --ok`, `--ok-c` bg, `check` icon at 22px in `--on-ok-c`, custom `doneText` or default "{label} captured"
- Always `min-height: 68px`, `r-lg`, `12×14 padding`, `10 mb`, `transition: all 150ms`

### 7.8 `MiniTL` — Handshake progress dots
6-dot inline timeline for trip rows. Each step is one of: `done` / `active` / `warn` / `critical` / `pending`.
- Dot: `8×8`, full circle, colour-mapped (`done→ok`, `active→sec`, `warn→warn`, `critical→err`, `pending→outline-v` with 1.5px outline-v border)
- Connector: `flex:1 / max-width:18 / height:2`; if previous was done, colour is `ok+88`, else `outline-v+4d`

### 7.9 `Timeline` (`Timeline` + `TL_EVENTS`)
Vertical event log for Trip Detail. Each event has:
- **Node**: 30×30 circle, type-coloured (`done→ok`, `active→sec` *with `pulse` className*, `warn→warn-c`, `critical→err`, `pending→surf-high with outline-v border`, `cp→surf-high`). Text is the step letter ("0".."5", "✓" for checkpoint, "!" for exception) or the `check` icon (14px) for `done`.
- **Connector**: 2px vertical line, `flex:1`, `min-height:20`, `4px margin-y`. Colour `ok+66` if event is `done`/`cp`, else `outline-v+4d`.
- **Body**: `15px / 700` label + meta line (`11px / 500 / 0.03em / --sec / tabular-nums`, prefixed by 10px `clock` icon) + optional detail (`13px / --on-surf-v`) + optional `exc` warn pill + optional `res` resolved line + optional `ChainTag`.

### 7.10 `StatCard`
`--surf-lowest` bg, `r-lg`, `16×20 padding`, `flex:1`, elevation 3.
- Value: `28px / 800 / -0.03em / Inter`. Colour `--err` if `warn`, `--ok` if `success`, else `--on-surf`.
- Label: `12px / 500 / --on-surf-v / 6px margin-top`

### 7.11 `Stepper` (driver)
Horizontal dots-and-lines, top-of-screen under `MobHead`. `--surf-lowest` bg, level-1 elevation, `8×16 padding`, `3px gap`.
- Dot: `8×8` rest; `10×10` and `.pulse` className when current; `--ok` if past, `--sec` if current, `--outline-v` if future
- Connector: `flex:1 / height:2`, `--ok+88` if past, `--outline-v+4d` otherwise

### 7.12 `HBanner` (driver Handshake banner)
Full-width banner at top of each driver handshake screen. 5 types: `default` (secondary palette), `warn`, `critical`, `success`, `highest` (uses `--primary` bg, white-tinted text — H5 only).
- Step eyebrow: `10px / 700 / 0.08em UPPER`, colour-matched
- Name: `18px / 800 / -0.02em`
- Sub: `12px / colour-matched`

### 7.13 `Sidebar` (dispatcher)
- Width `220px`, `--primary` bg, full height
- **Header**: 18px padding, secondary-square logo mark (32×32, `--sec` bg, `r-md`) + "FreightProof" wordmark (16px/800/-0.02em) + "EVIDENCE PLATFORM" eyebrow (10px/0.06em UPPER, `rgba(255,255,255,0.35)`)
- **Nav items**: 9×18 padding, 15px icon, 14px label. Active state: `rgba(255,255,255,0.1)` bg, `3px solid --sec` left border, icon → `--sec`, label → white at 600 weight. Inactive: transparent bg + 3px transparent border, icon `rgba(255,255,255,0.45)`, label `rgba(255,255,255,0.55)`. Hover (when inactive): `rgba(255,255,255,0.06)`.
- **Group headers**: `10px / 700 / 0.12em UPPER`, `rgba(255,255,255,0.3)`, `12×18×4` padding. Inserted before first item of each group.
- **Badge**: `--err` bg, white, `10px/700`, `r-sm`, `1×6 padding`, right-aligned.
- **Footer**: 12×18 padding, 1px top border in `rgba(255,255,255,0.08)`. User avatar (28×28, `rgba(255,255,255,0.1)`, `user` icon at 13px), name `12/600`, role `10/--outline-v`.

### 7.14 `TopBar`
Dispatcher header strip. `60px height`, `--surf-lowest`, `0 24 padding`, bottom 1px in `--outline-v+'33'`, elevation level 1.
- Title: 18/800/-0.02em
- Sub (optional): 11/500/0.03em/--sec/tabular-nums
- Right slot (`children`): flex with 8px gap (chips, buttons)

### 7.15 `MobHead` (driver)
Mobile header. `10×16 padding`, level-1 elevation. Optional back button (left, `--sec` `back` icon at 20px). Title 17/800. Optional `sub` (11/500/--sec/tabular-nums). Optional `right` text slot (12/700/--sec).

### 7.16 `SecHead` (table section header)
Sticky-feeling band inside cards. `--surf-low` bg, `10×24 padding`. Title `11px/700/0.1em UPPER/--on-surf-v`. Optional gradient-primary action button on right (6×16, 13/600, with `plus` icon).

### 7.17 `CTA` (driver bottom bar)
Always-pinned bottom bar on driver screens. `10×14 padding`, 1px top border, `--surf-lowest` bg.
- **Primary button**: full-flex, gradient-primary (or `--surf-high` if disabled), `r-lg`, `14 padding`, `16/700`. Disabled opacity 0.5.
- **Panic button**: fixed width, `--err` bg, white, `r-lg`, `14×16 padding`, `siren` icon at 18px. *Always visible on driver screens.*

### 7.18 `Phone` (driver device frame)
`390×844`, `r:48px`, `--surf` bg, elevation level 7 with inset 3px ring at `#1a1a1e`.
- Status bar: 46px, `--primary` bg, "9:41" / "100%" text, plus 100×22 black notch positioned at top centre with bottom corners radius 14
- Home indicator footer: 28px, `--surf-lowest`, 110×4 pill in `--outline-v`

---

## 8. Layout Patterns

### 8.1 Dispatcher shell
```
┌─────────┬────────────────────────────────┐
│ Sidebar │ TopBar                          │
│ 220px   │ ────────────────────────────────│
│         │ Content area                    │
│         │ (var --surf, scroll-y here)     │
│         │                                 │
└─────────┴────────────────────────────────┘
```
Outer app chrome (`#0a0a0c` bg) wraps the dispatcher panel with `margin:12 / r-xl / elevation 6`.

### 8.2 Trip Detail split
Left: timeline (flex:1, `--surf-lowest`). Right: 256px info column (`--surf-low`, 20px padding) containing Trip Info card → Cargo card → Blockchain card → Hold Trip secondary button.

### 8.3 Create Trip wizard
3-step. TopBar `sub` shows "Step N of 3 — {phase name}". TopBar right slot holds **three 32×4 pills** that fill `--sec` when reached, `--outline-v` when not.
Step 3 lays out as: form card (flex:1) + dark Trip Summary sidebar (280px, `--primary` bg, `r-lg`, elevation 5, "Create Trip + Lock to Blockchain" primary CTA full-width).

### 8.4 Driver screen anatomy
```
MobHead              (level-1 shadow)
Stepper              (level-1 shadow, optional)
Scroll area
  HBanner
  GPS reading
  Section: "{verb} {object}" + CaptureBox
  Section: System checks
  Success state (--ok-c banner) when all green
CTA                  (gradient primary + panic siren)
```

---

## 9. Motion

- **All transitions**: `120ms` for hover/colour swaps, `150ms` for state changes (CaptureBox, check toggles), `200ms` for size changes (stepper dot growth, reconciliation card swap), `600ms` for chart bar fills.
- **Pulse keyframe** (live elements only):
  ```css
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(0,81,213,0.5); }
    70%  { box-shadow: 0 0 0 8px rgba(0,81,213,0); }
    100% { box-shadow: 0 0 0 0 rgba(0,81,213,0); }
  }
  .pulse { animation: pulse 1.8s ease-out infinite; }
  ```
  Applied to: active timeline node, current stepper dot. Never more than one pulsing element per screen.
- **Press state**: `scale(0.97)` on `mousedown`, release on `mouseup`. Hover brightness: `filter: brightness(1.12)`.

---

## 10. Usage Rules

1. **One pulse per screen, max.** It marks the next action, nothing else.
2. **Evidence tags only on handshakes.** H1=Medium, H2=High, H3=Medium, H4=High, H5=Highest. Never on checkpoints/exceptions.
3. **Chain tag only when actually anchored.** If a receipt isn't yet on Hedera, no ChainTag — fall back to plain meta text.
4. **Tabular nums for every identifier.** Order refs, plates, seals, hashes, GPS, timestamps, parcel counts.
5. **Gradient = primary action only.** Secondary buttons stay flat (`--surf-high`). One gradient CTA per view.
6. **Status colour comes from the chip, not the row.** Don't tint table rows by status — the chip and exception count are the only colour signals.
7. **Mismatch states use error-container, not error.** Soft red bg (`--err-c`) with `--err` text — never solid red panels.
8. **PANIC is always reachable** on driver screens, in the CTA bar. Never tucked into a menu.
9. **Sidebar group order is fixed**: Overview → Trips → Reporting. New surfaces slot into the matching group.
10. **No emoji.** Status is communicated by chip + dot + label. Icons are stroke-only from the `IP` set.

---

## 11. Reference HTMLs

The dispatcher and driver page extracts live in `docs/reference/`:

| File | Component | Notes |
|---|---|---|
| `dispatcher-dashboard.html` | `Dashboard` | Stat row, exception banner, Active Trips table |
| `dispatcher-create-trip.html` | `CreateTrip` | 3-step wizard, dark summary card |
| `dispatcher-trip-detail.html` | `TripDetail` + `Timeline` | Most complex screen — use as primary reference |
| `dispatcher-trip-history.html` | `TripHistory` | Filter row + striped table |
| `dispatcher-sla-reports.html` | `SLAReports` | Stat row + horizontal bar chart + export panel |
| `driver-trip-home.html` | `TripHome` | Active trip card, primary action, panic |
| `driver-h1-gate-in.html` | `GateIn` | Capture + 3-check pattern |
| `driver-h2-loading.html` | `Loading` | Polling → loaded two-phase |
| `driver-h3-gate-out.html` | `GateOut` | Seal verification |
| `driver-h4-dest-gate-in.html` | `DestGateIn` | Seal-mismatch critical state |
| `driver-h5-unloading.html` | `Unloading` | Highest-evidence banner, 3-way count reconciliation |
| `driver-checkpoint.html` | `Checkpoint` | Selfie + optional cargo photo, batch-anchored note |

> Each reference file imports nothing — it's a standalone self-contained HTML snippet of that screen's React component so Claude Code can read it in isolation. Treat references as **examples**, this document as **contract**.

---

## 12. Appendix — CSS variable block (paste-ready)

```css
:root {
  --surf: #fcf8f9;
  --surf-low: #f6f3f4;
  --surf-lowest: #ffffff;
  --surf-high: #e5e2e3;

  --primary: #1b1b1c;
  --primary-c: #303031;
  --on-primary: #ffffff;

  --sec: #0051d5;
  --sec-c: #d8e2ff;
  --on-sec: #ffffff;
  --on-sec-c: #001551;

  --err: #ba1a1a;
  --err-c: #ffdad6;
  --on-err: #ffffff;
  --on-err-c: #410002;

  --warn: #805600;
  --warn-c: #ffb95f;
  --on-warn-c: #2b1700;

  --ok: #006c4c;
  --ok-c: #89f8c7;
  --on-ok-c: #002114;

  --chain: #006874;
  --chain-c: #97f0ff;
  --on-chain-c: #001f24;

  --on-surf: #1b1b1c;
  --on-surf-v: #46464f;
  --outline: #777680;
  --outline-v: #c7c6ca;

  --r-sm: 3px;
  --r-md: 6px;
  --r-lg: 10px;
  --r-xl: 14px;
}

@keyframes pulse {
  0%   { box-shadow: 0 0 0 0 rgba(0,81,213,0.5); }
  70%  { box-shadow: 0 0 0 8px rgba(0,81,213,0); }
  100% { box-shadow: 0 0 0 0 rgba(0,81,213,0); }
}
.pulse { animation: pulse 1.8s ease-out infinite; }

body { font-family: 'Inter', sans-serif; background: var(--surf); color: var(--on-surf); -webkit-font-smoothing: antialiased; }
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-thumb { background: #c7c6ca44; border-radius: 2px; }
```

---

**End of v2 design system.** Reference HTMLs are split in a follow-up step. Brutalist v1 lives at `docs/archive/DESIGN_SYSTEM_brutalist_v1.md` for trace.
