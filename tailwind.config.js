/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Dark is the only theme. The PRD asks for dark by default and specifies no
  // light-mode behaviour, so the app commits to one look rather than carrying
  // an untested second palette.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0b0d10',
          800: '#12151a',
          700: '#191d24',
          600: '#232830',
          500: '#31373f',
        },
        accent: {
          DEFAULT: '#6ea8fe',
          muted: '#3d6ebc',
        },
        ok: '#4ade80',
        warn: '#fbbf24',
        bad: '#f87171',
      },
      fontFamily: {
        // System stacks only. Bundling a webfont would be fine, but there is no
        // reason to ship one when the platform fonts are already correct.
        sans: ['Segoe UI', 'Roboto', 'system-ui', 'sans-serif'],
        mono: ['Cascadia Mono', 'Consolas', 'Roboto Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
