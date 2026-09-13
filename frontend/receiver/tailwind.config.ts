import type { Config } from 'tailwindcss'

// Deliberately NOT the driver/dispatcher design system. This page is seen once, by
// someone who has never seen it before and will never see it again, on their own phone
// in a warehouse. It needs maximum legibility and zero brand ceremony — Tailwind's stock
// neutral scale is the right answer, and importing the full token map would drag a theme
// system onto a single-screen app that has no use for one.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}

export default config
