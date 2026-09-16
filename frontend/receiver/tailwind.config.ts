import type { Config } from 'tailwindcss'

// Deliberately NOT the driver/dispatcher design system: this single-screen page needs
// maximum legibility, not the full brand token map.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}

export default config
