import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#000000',
          container: '#1A1A1A',
          'on': '#ffffff',
          'on-container': '#F4F4F0',
        },
        secondary: {
          DEFAULT: '#FF4F00',
          container: '#FFD2C2',
          'on': '#ffffff',
          'on-container': '#4A1700',
        },
        tertiary: {
          DEFAULT: '#E6A800',
          container: '#FFEB99',
          'on': '#ffffff',
          'on-container': '#332500',
          'fixed-dim': '#FFC200',
        },
        success: {
          DEFAULT: '#00D640',
          container: '#A3FFC2',
          // dark green — white (#fff) fails contrast on this brightness
          'on': '#00330F',
          'on-container': '#00330F',
        },
        error: {
          DEFAULT: '#FF2A00',
          container: '#FFC7C2',
          'on': '#ffffff',
          'on-container': '#4A0C00',
        },
        surface: {
          DEFAULT: '#EFEFE9',
          'container-lowest': '#ffffff',
          'container-low': '#E4E3DB',
          container: '#D9D8CF',
          'container-high': '#CECDC2',
          'container-highest': '#C3C2B6',
          'on': '#1A1A1A',
          'on-variant': '#4D4D4D',
        },
        outline: {
          DEFAULT: '#000000',
          variant: '#8A8A85',
        },
      },
      fontFamily: {
        sans: ['var(--font-space-grotesk)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-ibm-plex-mono)', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'hard-sm': '2px 2px 0px #000000',
        'hard':    '4px 4px 0px #000000',
        'hard-lg': '6px 6px 0px #000000',
        'hard-up': '0 -4px 0px #000000',
      },
    },
  },
  plugins: [],
};

export default config;
