import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
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
        // (#c7c6ca / hsl(var(--border))), which existing components already
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
        },
        error: {
          DEFAULT:       'rgb(var(--fp-error) / <alpha-value>)',
          container:     'rgb(var(--fp-error-container) / <alpha-value>)',
          on:            'rgb(var(--fp-error-on) / <alpha-value>)',
          'on-container':'rgb(var(--fp-error-on-container) / <alpha-value>)',
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
