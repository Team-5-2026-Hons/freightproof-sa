import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'
import { TYPE_SCALE } from './lib/constants/type-scale'

const SYSTEM_SANS = ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
const SYSTEM_MONO = ['ui-monospace', 'SF Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'Roboto Mono', 'monospace']

const config: Config = {
  future: {
    hoverOnlyWhenSupported: true,
  },
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
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
        border: 'hsl(var(--border))',

        chain: {
          DEFAULT: 'rgb(var(--fp-chain) / <alpha-value>)',
          c:       'rgb(var(--fp-chain-container) / <alpha-value>)',
          on:      'rgb(var(--fp-chain-on) / <alpha-value>)',
          onc:     'rgb(var(--fp-chain-on-container) / <alpha-value>)',
          tint:    'rgb(var(--fp-chain-tint) / <alpha-value>)',
        },

        fill:     'rgb(var(--fp-fill) / <alpha-value>)',
        hairline: 'rgb(var(--fp-hairline) / <alpha-value>)',
        attention: {
          DEFAULT: 'rgb(var(--fp-attention) / <alpha-value>)',
          tint:    'rgb(var(--fp-attention-tint) / <alpha-value>)',
          ink:     'rgb(var(--fp-attention-ink) / <alpha-value>)',
        },

        outline: {
          DEFAULT: 'rgb(var(--fp-outline) / <alpha-value>)',
          variant: 'rgb(var(--fp-outline-variant) / <alpha-value>)',
        },

        primary: {
          DEFAULT:       'rgb(var(--fp-primary) / <alpha-value>)',
          container:     'rgb(var(--fp-primary-container) / <alpha-value>)',
          on:            'rgb(var(--fp-primary-on) / <alpha-value>)',
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

      screens: {
        xs: '380px',
      },

      fontFamily: {
        sans:     SYSTEM_SANS,
        mono:     SYSTEM_MONO,
      },

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
        'fade-in-scale': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-8px) scale(0.97)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'radar-pulse': {
          from: { transform: 'scale(1)', opacity: '0.6' },
          to: { transform: 'scale(1.8)', opacity: '0' },
        },
        'truck-drive': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-2px)' },
        },
        'anchor-slide': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(250%)' },
        },
        'panic-pulse': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
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
        'road-scroll': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(calc(var(--road-tile, 1.5rem) * -1))' },
        },
      },
      animation: {
        'fade-in-scale': 'fade-in-scale 200ms ease-out',
        'toast-in': 'toast-in 250ms ease-out',
        'radar-pulse': 'radar-pulse 1.2s ease-out infinite',
        'truck-drive': 'truck-drive 500ms ease-in-out infinite',
        'road-scroll': 'road-scroll 500ms linear infinite',
        'push-in': 'push-in 320ms cubic-bezier(0.32, 0.72, 0, 1)',
        'pop-in': 'pop-in 320ms cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-up': 'sheet-up 320ms cubic-bezier(0.32, 0.72, 0, 1)',
        'anchor-slide': 'anchor-slide 1.4s ease-in-out infinite',
        'panic-pulse': 'panic-pulse 1s ease-in-out infinite',
      },

      backgroundImage: {
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
