import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surf: { lowest: '#ffffff', DEFAULT: '#fcf8f9', low: '#f6f3f4', high: '#e5e2e3' },
        ink: { DEFAULT: '#1b1b1c', soft: '#303031' },
        sec: { DEFAULT: '#0051d5', c: '#d8e2ff', on: '#001551' },
        err: { DEFAULT: '#ba1a1a', c: '#ffdad6', on: '#410002' },
        warn: { DEFAULT: '#805600', c: '#ffb95f', on: '#2b1700', soft: '#fffbea' },
        ok: { DEFAULT: '#006c4c', c: '#89f8c7', on: '#002114' },
        chain: { DEFAULT: '#006874', c: '#97f0ff', on: '#001f24' },
        muted: '#46464f',
        outline: { DEFAULT: '#777680', v: '#c7c6ca' },
      },
      fontSize: {
        micro: '10px', caption: '11px', meta: '12px', small: '13px', body: '14px',
        lead: '15px', subhead: '16px', head: '17px', title: '22px', display: '28px',
      },
      letterSpacing: { eyebrow: '0.1em' },
      borderRadius: { sm: '3px', md: '6px', lg: '10px', xl: '14px' },
      boxShadow: { card: '0 2px 12px rgba(27,27,28,0.06)', float: '0 8px 32px rgba(27,27,28,0.18)' },
      fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}

export default config
