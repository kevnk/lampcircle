/** @type {import('tailwindcss').Config} */
// Every color comes from the Lamp Circle logo: the navy lantern, its amber bars and the cream light it throws.
// Each role has a light and a dark value, set in src/index.css. docs/brand/README.md says where each is used.
const role = name => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        page: role('page'),
        panel: role('panel'),
        raised: role('raised'),
        well: role('well'),
        lantern: role('lantern'),
        line: role('line'),
        edge: role('edge'),
        ink: role('ink'),
        muted: role('muted'),
        faint: role('faint'),
        amber: role('amber'),
        danger: role('danger'),
        side: role('side'),
        accent: { DEFAULT: role('accent'), hover: role('accent-hover'), soft: 'rgb(var(--accent) / 0.15)' },
        // Section shades, quietest to strongest, and the text that sits on each.
        shade: { light: role('shade-light'), mid: role('shade-mid'), dark: role('shade-dark'), black: role('shade-black') },
        'on-shade': { light: role('on-shade-light'), mid: role('on-shade-mid'), dark: role('on-shade-dark'), black: role('on-shade-black') },
        wave: { bg: role('wave-bg'), rest: role('wave-rest') },
        // The same in both modes: the logo's navy, and the cream of its light.
        navy: '#10283A',
        cream: '#F6ECDD',
      },
      fontFamily: {
        sans: ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--accent) / 0.35), 0 0 28px -2px rgb(var(--accent) / var(--glow))',
        'glow-sm': '0 0 14px -2px rgb(var(--accent) / var(--glow))',
      },
    },
  },
  plugins: [],
};
