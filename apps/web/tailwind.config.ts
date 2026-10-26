import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 700: '#16294d', 800: '#0f1f3d', 900: '#0a1730' },
        primary: { DEFAULT: '#0d9488', dark: '#0f766e', light: '#ccfbf1' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Noto Sans Sinhala', 'Nirmala UI', 'Iskoola Pota', 'sans-serif'],
      },
      boxShadow: { card: '0 1px 3px rgba(15, 31, 61, 0.08), 0 1px 2px rgba(15, 31, 61, 0.06)' },
    },
  },
  plugins: [],
};

export default config;
