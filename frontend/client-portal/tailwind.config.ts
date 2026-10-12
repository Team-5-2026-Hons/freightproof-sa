import type { Config } from 'tailwindcss'

// The FreightProof design-system tokens (frontend/DESIGN_SYSTEM.md §2) this page uses:
// paper surfaces, ink primary, and the domain palettes — chain for anything anchored to
// Hedera, status roles for findings. Colour is information here, never decoration.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surf: { lowest: '#ffffff', DEFAULT: '#fcf8f9', low: '#f6f3f4', high: '#e5e2e3' },
        ink: { DEFAULT: '#1b1b1c', soft: '#303031' },
        sec: { DEFAULT: '#0051d5', c: '#d8e2ff', on: '#001551' },
        err: { DEFAULT: '#ba1a1a', c: '#ffdad6', on: '#410002' },
        warn: { DEFAULT: '#805600', c: '#ffb95f', on: '#2b1700' },
        ok: { DEFAULT: '#006c4c', c: '#89f8c7', on: '#002114' },
        chain: { DEFAULT: '#006874', c: '#97f0ff', on: '#001f24' },
        muted: '#46464f',
        outline: { DEFAULT: '#777680', v: '#c7c6ca' },
      },
      borderRadius: { sm: '3px', md: '6px', lg: '10px', xl: '14px' },
      boxShadow: { card: '0 2px 12px rgba(27,27,28,0.06)', float: '0 8px 32px rgba(27,27,28,0.18)' },
      fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}

export default config
