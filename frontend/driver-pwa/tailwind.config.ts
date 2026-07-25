import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
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
        // Target vocabulary for new components going forward (mirrors frontend/dispatcher's already-completed migration). Not yet consumed in driver-pwa — adopted incrementally as components are rebuilt.
        // ── Design-system shorthand tokens — mirror CSS variable names exactly ──
        canvas:       '#0a0a0c',
        surf:         '#fcf8f9',
        'surf-low':   '#f6f3f4',
        'surf-lowest':'#ffffff',
        'surf-high':  '#e5e2e3',
        'on-surf':    '#1b1b1c',
        'on-surf-v':  '#46464f',

        sec:   { DEFAULT: '#0051d5', c: '#d8e2ff', on: '#ffffff', onc: '#001551' },
        ok:    { DEFAULT: '#006c4c', c: '#89f8c7', on: '#ffffff', onc: '#002114' },
        err:   { DEFAULT: '#ba1a1a', c: '#ffdad6', on: '#ffffff', onc: '#410002' },
        warn:  { DEFAULT: '#805600', c: '#ffb95f', on: '#ffffff', onc: '#2b1700' },
        chain: { DEFAULT: '#006874', c: '#97f0ff', on: '#ffffff', onc: '#001f24' },

        outline: {
          DEFAULT: '#777680',
          v:       '#c7c6ca',
          variant: '#c7c6ca',   // backwards-compat alias used by existing components
        },

        // ── Semantic tokens — backwards-compat names with corrected hex values ──
        // Match the shorthand tokens above; kept so existing class names work
        // during the migration. New components should use the shorthand tokens.
        primary: {
          DEFAULT:       '#1b1b1c',   // was #000000 — now matches --primary
          container:     '#303031',
          on:            '#ffffff',
          'on-container':'rgba(255,255,255,0.45)',
        },
        secondary: {
          DEFAULT:       '#0051d5',
          container:     '#d8e2ff',   // was #316bf3
          on:            '#ffffff',
          'on-container':'#001551',   // was #fefcff
          fixed:         '#d8e2ff',
        },
        tertiary: {
          DEFAULT:       '#805600',   // was #b87500
          container:     '#ffb95f',   // was #ffddb8
          on:            '#ffffff',
          'on-container':'#2b1700',
        },
        success: {
          DEFAULT:       '#006c4c',   // was #1a7c3e
          container:     '#89f8c7',   // was #c8f2d9
          on:            '#ffffff',
          'on-container':'#002114',   // was #0a3d1f
        },
        error: {
          DEFAULT:       '#ba1a1a',
          container:     '#ffdad6',
          on:            '#ffffff',
          'on-container':'#410002',
        },
        surface: {
          DEFAULT:            '#fcf8f9',
          'container-lowest': '#ffffff',
          'container-low':    '#f6f3f4',
          container:          '#f0edee',
          'container-high':   '#e5e2e3',   // was #eae7e8
          'container-highest':'#e5e2e3',
          dim:                '#dcd9da',
          on:                 '#1b1b1c',
          'on-variant':       '#46464f',
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
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.97)' },
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
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in-scale': 'fade-in-scale 200ms ease-out',
        'toast-in': 'toast-in 250ms ease-out',
        'confirm-pulse': 'confirm-pulse 400ms ease-in-out',
        'radar-pulse': 'radar-pulse 1.2s ease-out infinite',
      },
    },
  },
  plugins: [animate],
}

export default config
