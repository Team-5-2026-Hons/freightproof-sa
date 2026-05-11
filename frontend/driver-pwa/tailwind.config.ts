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
