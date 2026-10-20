/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1C1C1A',
        paper: '#ECECE7',
        line: '#D4D4CE',
        muted: '#6B6B66',
        faint: '#9A9A94',
        accent: { DEFAULT: '#C2410C', hover: '#A3360A', soft: '#FBE3D6' },
        shade: { light: '#DADAD4', mid: '#C6C6C0', dark: '#5E5E5A', black: '#1C1C1A' },
        wave: { bg: '#F4F4F1', rest: '#A6A6A0' },
        stage: {
          bg: '#141414',
          card: '#242422',
          line: '#3A3A37',
          text: '#ECECE7',
          muted: '#9A9A94',
          accent: '#EE8A4F',
          warn: '#3A2E28',
        },
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Space Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
