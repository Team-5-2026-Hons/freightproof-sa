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
        // ── Design-system shorthand tokens — mirror CSS variable names exactly ──
        // Use these when building new UI. Class names: bg-surf, text-on-surf, etc.
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
          // backwards-compat alias used by existing components
          variant: '#c7c6ca',
        },

        // ── Semantic tokens — backwards-compat names with corrected hex values ──
        // These match the shorthand tokens above; kept so existing class names work
        // during the UI rebuild. Remove once all components use shorthand names.
        primary: {
          DEFAULT:       '#1b1b1c',   // was #000000 — now matches --primary
          container:     '#303031',   // --primary-c
          on:            '#ffffff',
          'on-container':'rgba(255,255,255,0.45)',
        },
        secondary: {
          DEFAULT:       '#0051d5',
          container:     '#d8e2ff',   // was #316bf3 — now matches --sec-c
          on:            '#ffffff',
          'on-container':'#001551',   // was #fefcff — now matches --on-sec-c
        },
        success: {
          DEFAULT:       '#006c4c',   // was #1a7c3e — now matches --ok
          container:     '#89f8c7',   // was #c8f2d9 — now matches --ok-c
          on:            '#ffffff',
          'on-container':'#002114',   // was #0a3d1f — now matches --on-ok-c
        },
        error: {
          DEFAULT:       '#ba1a1a',
          container:     '#ffdad6',
          on:            '#ffffff',
          'on-container':'#410002',
        },
        warning: {
          DEFAULT:       '#805600',   // was tertiary #b87500 — now matches --warn
          container:     '#ffb95f',   // was #ffddb8 — now matches --warn-c
          on:            '#ffffff',
          'on-container':'#2b1700',
        },
        // tertiary kept as alias so nothing silently breaks during transition
        tertiary: {
          DEFAULT:       '#805600',
          container:     '#ffb95f',
          on:            '#ffffff',
          'on-container':'#2b1700',
          'fixed-dim':   '#ffb95f',
        },
        surface: {
          DEFAULT:            '#fcf8f9',
          'container-lowest': '#ffffff',
          'container-low':    '#f6f3f4',
          container:          '#f0edee',
          'container-high':   '#e5e2e3',
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
        // Design-system elevation levels — matches DESIGN_SYSTEM.md §4
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
    },
  },
  plugins: [],
}

export default config
