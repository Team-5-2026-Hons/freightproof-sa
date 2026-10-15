import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'
import { TYPE_SCALE } from './lib/constants/type-scale'

const SYSTEM_SANS = ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
const SYSTEM_MONO = ['ui-monospace', 'SF Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'Roboto Mono', 'monospace']

const config: Config = {
  // Touch screens have no hover, but iOS WebKit still applies :hover on tap and leaves it
  // stuck until the next tap elsewhere — every `hover:` tint in this app was latching on
  // after a press. This wraps hover utilities in @media (hover: hover) so they only exist
  // where a pointer can actually hover; presses get explicit `active:` states instead.
  future: {
    hoverOnlyWhenSupported: true,
  },
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  // Class strategy, not 'media': the driver picks the theme in Settings and that choice
  // has to be able to override the device (a phone left on auto-dark still needs a
  // readable screen in daylight). The class lands on <html> — see the pre-paint script in
  // app/layout.tsx and components/theme/ThemeManager.tsx.
  //
  // Note that almost nothing in this app uses `dark:` variants: the token map below is
  // variable-backed, so the theme swaps underneath every existing class. The variants
  // exist for the handful of cases a token genuinely cannot express.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── shadcn/ui CSS-variable-driven tokens ──
        // Names picked to avoid clobbering the hex-object tokens below (e.g. the
        // existing `primary`/`secondary`/`surface` scales, which every screen
        // still uses via classes like bg-surface-container-lowest). Values come
        // from app/globals.css :root, mapped onto the same hex palette.
        background:   'hsl(var(--background))',
        foreground:   'hsl(var(--foreground))',
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        input: 'hsl(var(--input))',
        ring:  'hsl(var(--ring))',
        // Sets the default `border` utility color. Same value as outline-variant
        // (#919099 / hsl(var(--border))), which existing components already
        // reference explicitly via border-outline-variant.
        border: 'hsl(var(--border))',
        // ── Design-system tokens ──
        //
        // Every value below resolves through a --fp-* CSS variable declared in
        // app/globals.css, where the light and dark palettes live side by side. The
        // literal hex that used to sit here could only ever describe one theme; routing
        // it through a variable is what lets `bg-surface-container-lowest` mean "white"
        // in daylight and "the raised-card tone" at night without a single component
        // changing.
        //
        // `rgb(var(--x) / <alpha-value>)` is the required shape, not a style choice.
        // Tailwind substitutes <alpha-value> when a class carries an opacity modifier
        // (bg-secondary/10, border-outline-variant/25) and 1 when it does not. A bare
        // `var(--x)` compiles, but Tailwind v3 then drops every modifier silently — the
        // frames and dividers throughout the app would flatten to full opacity with no
        // build error to catch it.
        //
        // Target vocabulary for new components going forward (mirrors frontend/dispatcher's already-completed migration). Not yet consumed in driver-pwa — adopted incrementally as components are rebuilt.
        canvas:       'rgb(var(--fp-canvas) / <alpha-value>)',
        surf:         'rgb(var(--fp-surface) / <alpha-value>)',
        'surf-low':   'rgb(var(--fp-surface-container-low) / <alpha-value>)',
        'surf-lowest':'rgb(var(--fp-surface-container-lowest) / <alpha-value>)',
        'surf-high':  'rgb(var(--fp-surface-container-high) / <alpha-value>)',
        'on-surf':    'rgb(var(--fp-surface-on) / <alpha-value>)',
        'on-surf-v':  'rgb(var(--fp-surface-on-variant) / <alpha-value>)',

        sec: {
          DEFAULT: 'rgb(var(--fp-secondary) / <alpha-value>)',
          c:       'rgb(var(--fp-secondary-container) / <alpha-value>)',
          on:      'rgb(var(--fp-secondary-on) / <alpha-value>)',
          onc:     'rgb(var(--fp-secondary-on-container) / <alpha-value>)',
        },
        ok: {
          DEFAULT: 'rgb(var(--fp-success) / <alpha-value>)',
          c:       'rgb(var(--fp-success-container) / <alpha-value>)',
          on:      'rgb(var(--fp-success-on) / <alpha-value>)',
          onc:     'rgb(var(--fp-success-on-container) / <alpha-value>)',
        },
        err: {
          DEFAULT: 'rgb(var(--fp-error) / <alpha-value>)',
          c:       'rgb(var(--fp-error-container) / <alpha-value>)',
          on:      'rgb(var(--fp-error-on) / <alpha-value>)',
          onc:     'rgb(var(--fp-error-on-container) / <alpha-value>)',
        },
        warn: {
          DEFAULT: 'rgb(var(--fp-tertiary) / <alpha-value>)',
          c:       'rgb(var(--fp-tertiary-container) / <alpha-value>)',
          on:      'rgb(var(--fp-tertiary-on) / <alpha-value>)',
          onc:     'rgb(var(--fp-tertiary-on-container) / <alpha-value>)',
        },
        chain: {
          DEFAULT: 'rgb(var(--fp-chain) / <alpha-value>)',
          c:       'rgb(var(--fp-chain-container) / <alpha-value>)',
          on:      'rgb(var(--fp-chain-on) / <alpha-value>)',
          onc:     'rgb(var(--fp-chain-on-container) / <alpha-value>)',
          tint:    'rgb(var(--fp-chain-tint) / <alpha-value>)',
        },

        // Overhaul (Oct 2026) flat-grouping tokens: the grey face of pills, tiles and
        // fields, and the inset rule between list rows. See app/globals.css.
        fill:     'rgb(var(--fp-fill) / <alpha-value>)',
        hairline: 'rgb(var(--fp-hairline) / <alpha-value>)',
        // Waiting / under review / offline. Amber text on a pale amber ground; never red,
        // because none of these states is an error.
        attention: {
          DEFAULT: 'rgb(var(--fp-attention) / <alpha-value>)',
          tint:    'rgb(var(--fp-attention-tint) / <alpha-value>)',
          ink:     'rgb(var(--fp-attention-ink) / <alpha-value>)',
        },

        outline: {
          DEFAULT: 'rgb(var(--fp-outline) / <alpha-value>)',
          v:       'rgb(var(--fp-outline-variant) / <alpha-value>)',
          variant: 'rgb(var(--fp-outline-variant) / <alpha-value>)',   // backwards-compat alias used by existing components
        },

        // ── Semantic tokens — backwards-compat names ──
        // Same variables as the shorthand tokens above; kept so existing class names
        // work during the migration. New components should use the shorthand tokens.
        primary: {
          DEFAULT:       'rgb(var(--fp-primary) / <alpha-value>)',
          container:     'rgb(var(--fp-primary-container) / <alpha-value>)',
          on:            'rgb(var(--fp-primary-on) / <alpha-value>)',
          // Was a literal rgba(255,255,255,0.45), i.e. white-on-ink baked flat. Now a
          // solid tone of the same appearance, because a hard-coded white would have
          // been invisible once `primary` itself becomes light in the dark theme.
          'on-container':'rgb(var(--fp-primary-on-container) / <alpha-value>)',
        },
        secondary: {
          DEFAULT:       'rgb(var(--fp-secondary) / <alpha-value>)',
          container:     'rgb(var(--fp-secondary-container) / <alpha-value>)',
          on:            'rgb(var(--fp-secondary-on) / <alpha-value>)',
          'on-container':'rgb(var(--fp-secondary-on-container) / <alpha-value>)',
          fixed:         'rgb(var(--fp-secondary-fixed) / <alpha-value>)',
        },
        tertiary: {
          DEFAULT:       'rgb(var(--fp-tertiary) / <alpha-value>)',
          container:     'rgb(var(--fp-tertiary-container) / <alpha-value>)',
          on:            'rgb(var(--fp-tertiary-on) / <alpha-value>)',
          'on-container':'rgb(var(--fp-tertiary-on-container) / <alpha-value>)',
        },
        success: {
          DEFAULT:       'rgb(var(--fp-success) / <alpha-value>)',
          container:     'rgb(var(--fp-success-container) / <alpha-value>)',
          on:            'rgb(var(--fp-success-on) / <alpha-value>)',
          'on-container':'rgb(var(--fp-success-on-container) / <alpha-value>)',
          // Status-banner ground and its ink; the container above is a saturated chip fill.
          tint:          'rgb(var(--fp-success-tint) / <alpha-value>)',
          ink:           'rgb(var(--fp-success-ink) / <alpha-value>)',
        },
        error: {
          DEFAULT:       'rgb(var(--fp-error) / <alpha-value>)',
          container:     'rgb(var(--fp-error-container) / <alpha-value>)',
          on:            'rgb(var(--fp-error-on) / <alpha-value>)',
          'on-container':'rgb(var(--fp-error-on-container) / <alpha-value>)',
          tint:          'rgb(var(--fp-error-tint) / <alpha-value>)',
        },
        surface: {
          DEFAULT:            'rgb(var(--fp-surface) / <alpha-value>)',
          'container-lowest': 'rgb(var(--fp-surface-container-lowest) / <alpha-value>)',
          'container-low':    'rgb(var(--fp-surface-container-low) / <alpha-value>)',
          container:          'rgb(var(--fp-surface-container) / <alpha-value>)',
          'container-high':   'rgb(var(--fp-surface-container-high) / <alpha-value>)',
          'container-highest':'rgb(var(--fp-surface-container-highest) / <alpha-value>)',
          dim:                'rgb(var(--fp-surface-dim) / <alpha-value>)',
          on:                 'rgb(var(--fp-surface-on) / <alpha-value>)',
          'on-variant':       'rgb(var(--fp-surface-on-variant) / <alpha-value>)',
        },
      },

      // Tailwind's smallest default breakpoint is `sm` at 640px — wider than every
      // phone this app runs on, so without an extra stop below it a 320px Galaxy A-series
      // and a 430px iPhone Pro Max render byte-identical layouts and one of the two is
      // always wrong. `xs` splits compact phones from standard ones; `sm` and up stays
      // tablet territory.
      screens: {
        xs: '380px',
      },

      // The platform's own face, not a downloaded one: on iOS `system-ui` resolves to SF
      // Pro, which brings Apple's optical sizes, size-specific tracking and Dynamic Type
      // metrics with it — none of which a webfont can reproduce — and on Android it
      // resolves to Roboto. The driver app is demoed on iPhones first, where Inter read as
      // a ported website. headline/display/body/label stay as aliases so existing
      // font-* classes keep resolving; they all mean "the system face" now.
      fontFamily: {
        sans:     SYSTEM_SANS,
        headline: SYSTEM_SANS,
        display:  SYSTEM_SANS,
        body:     SYSTEM_SANS,
        label:    SYSTEM_SANS,
        // Real monospace for measured data (coordinates, seal numbers) — the old alias
        // pointed back at Inter, so `font-mono` silently did nothing.
        mono:     SYSTEM_MONO,
      },

      // iOS text-style roles; see lib/constants/type-scale.ts for the ratios and why the
      // list lives outside this file.
      fontSize: TYPE_SCALE,

      borderRadius: {
        none:    '0px',
        sm:      '3px',
        DEFAULT: '3px',
        md:      '6px',
        lg:      '10px',
        xl:      '14px',
        '2xl':   '24px',
        full:    '9999px',
      },

      boxShadow: {
        'level-1': '0 1px 0 rgba(27,27,28,0.06)',
        'level-2': '0 2px 8px rgba(27,27,28,0.04)',
        'level-3': '0 2px 12px rgba(27,27,28,0.06)',
        'level-4': '0 2px 16px rgba(27,27,28,0.08)',
        'level-5': '0 8px 32px rgba(27,27,28,0.18)',
        'level-6': '0 16px 64px rgba(0,0,0,0.5)',
        // Backwards-compat aliases
        'ambient-sm':     '0 4px 20px rgba(27,27,28,0.06)',
        'ambient':        '0 8px 40px rgba(27,27,28,0.06)',
        'ambient-header': '0 8px 30px rgba(0,0,0,0.06)',
        'ambient-up':     '0 -4px 24px rgba(0,0,0,0.06)',
        'ambient-up-lg':  '0 -8px 40px rgba(0,0,0,0.08)',
      },

      zIndex: {
        raised:  '10',
        sticky:  '20',
        overlay: '40',
        modal:   '60',
        toast:   '80',
        panic:   '100',
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in-scale': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        // Drops DOWN from above: the toast viewport is anchored to the top of the screen
        // (components/ui/Toast.tsx), so a toast entering from below would slide the wrong
        // way past its own resting place.
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-8px) scale(0.97)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'confirm-pulse': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.15)' },
        },
        'radar-pulse': {
          from: { transform: 'scale(1)', opacity: '0.6' },
          to: { transform: 'scale(1.8)', opacity: '0' },
        },
        // Suspension bounce for the loading truck — small on purpose: the road under it
        // carries the sense of movement, the truck only has to look like it is riding on
        // something. See components/ui/TruckLoader.tsx.
        'truck-drive': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-2px)' },
        },
        // iOS push/pop (app/(app)/template.tsx). Starts at 0.6 opacity, never 0: the
        // incoming screen is legible from the first frame, it only settles into place.
        // An indeterminate run along the receipt's anchoring bar: Hedera gives no progress
        // to report, so the bar says "working", never a made-up percentage.
        'anchor-slide': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(250%)' },
        },
        // The panic screen's red vignette while a finger is on the swipe (7.1b): one full
        // cycle a second (1 Hz), far under WCAG 2.3.1's three flashes, and never below a
        // third of its strength so it reads as a glow, not a flash.
        'panic-pulse': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
        // A floating sheet rising from the bottom edge it is anchored to (Modal).
        'sheet-up': {
          from: { transform: 'translate3d(0, 2rem, 0)', opacity: '0' },
          to: { transform: 'translate3d(0, 0, 0)', opacity: '1' },
        },
        'push-in': {
          from: { transform: 'translate3d(1.5rem, 0, 0)', opacity: '0.6' },
          to: { transform: 'translate3d(0, 0, 0)', opacity: '1' },
        },
        'pop-in': {
          from: { transform: 'translate3d(-1.5rem, 0, 0)', opacity: '0.6' },
          to: { transform: 'translate3d(0, 0, 0)', opacity: '1' },
        },
        // Scrolls the dashed road exactly one tile per cycle, which is what makes the
        // loop seamless. --road-tile is set by the loader and read here and by the
        // `road` background image below, so the two can never drift apart.
        'road-scroll': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(calc(var(--road-tile, 1.5rem) * -1))' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in-scale': 'fade-in-scale 200ms ease-out',
        'toast-in': 'toast-in 250ms ease-out',
        'confirm-pulse': 'confirm-pulse 400ms ease-in-out',
        'radar-pulse': 'radar-pulse 1.2s ease-out infinite',
        'truck-drive': 'truck-drive 500ms ease-in-out infinite',
        'road-scroll': 'road-scroll 500ms linear infinite',
        // Apple's own deceleration curve for navigation transitions — fast out of the
        // gate, long gentle settle — at a short duration so it never feels like waiting.
        'push-in': 'push-in 320ms cubic-bezier(0.32, 0.72, 0, 1)',
        'pop-in': 'pop-in 320ms cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-up': 'sheet-up 320ms cubic-bezier(0.32, 0.72, 0, 1)',
        'anchor-slide': 'anchor-slide 1.4s ease-in-out infinite',
        'panic-pulse': 'panic-pulse 1s ease-in-out infinite',
      },

      backgroundImage: {
        // Dashed centre line for the loading truck's road: half a tile of ink, half a
        // tile of gap. currentColor so the strip takes its colour from the text token on
        // its wrapper rather than hard-coding one here.
        road:
          'repeating-linear-gradient(90deg,' +
          ' currentColor 0, currentColor calc(var(--road-tile, 1.5rem) / 2),' +
          ' transparent calc(var(--road-tile, 1.5rem) / 2), transparent var(--road-tile, 1.5rem))',
      },
    },
  },
  plugins: [animate],
}

export default config
