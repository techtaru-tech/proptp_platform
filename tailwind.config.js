/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // TechTaru's headline face (techtaru.com) — headings only, body stays Inter.
        display: ['"Clash Display"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // The app shell — TechTaru's deep ink neutrals (the techtaru.com page background is
        // 950), so the sidebar and every dark surface sit in the website's own family.
        shell: {
          50: '#f5f6f7',
          100: '#e8eaed',
          200: '#cbd0d6',
          300: '#a3acb6',
          400: '#717c89',
          500: '#525c6b',
          600: '#3d4654',
          700: '#2b333f',
          800: '#1a1f29',
          900: '#0f131a',
          950: '#070a0f',
        },
        // TechTaru primary — the "taru" teal of techtaru.com (#00c9c9 is 400 here).
        // The scale is shifted one step darker than the website's so that 600 — what solid
        // buttons and active nav use, always with white text — is #007d7d, which passes
        // contrast; the website's own 600 (#00a3a3) does not under white text.
        brand: {
          50: '#e6fbfb',
          100: '#ccf6f6',
          200: '#99eded',
          300: '#4fdede',
          400: '#00c9c9',
          500: '#00a3a3',
          600: '#007d7d',
          700: '#006a6a',
          800: '#005757',
          900: '#003d3d',
          950: '#002626',
        },
        // TechTaru secondary — the saffron of techtaru.com (#f97316 is 500). White on 500
        // is too low-contrast for a filled control, so anything with text on it uses 600
        // or darker.
        accent: {
          50: '#fff8eb',
          100: '#ffeec6',
          200: '#ffd98c',
          300: '#ffba53',
          400: '#ff9a2e',
          500: '#f97316',
          600: '#c2410c',
          700: '#9a3412',
          800: '#7c2d12',
          900: '#5c210d',
          950: '#3b1508',
        },
        // The leaf green of the logo's "taru" half and its crown (#64b975 is 500). Not a UI
        // colour — it is here so charts, gradients and illustrations can reach for the logo.
        blossom: {
          50: '#f0f8f2',
          100: '#e0f1e4',
          200: '#c1e3c8',
          300: '#a2d5ac',
          400: '#83c791',
          500: '#64b975',
          600: '#50945e',
          700: '#3c6f46',
          800: '#2f5737',
          900: '#23412a',
        },
        // The steel blue of the logo's "Tech" half (#428797 is 500).
        steel: {
          200: '#b3cfd5',
          300: '#8eb7c1',
          400: '#689fac',
          500: '#428797',
          600: '#356c79',
          700: '#28515b',
        },
        surface: {
          DEFAULT: '#ffffff',
          subtle: '#f6f7f9',
          muted: '#eef0f3',
        },
        ink: {
          DEFAULT: '#101828',
          muted: '#475467',
          subtle: '#667085',
          faint: '#98a2b3',
        },
        line: {
          DEFAULT: '#e4e7ec',
          strong: '#d0d5dd',
        },
        success: { 50: '#ecfdf3', 100: '#d1fadf', 500: '#12b76a', 600: '#039855', 700: '#027a48' },
        warning: { 50: '#fffaeb', 100: '#fef0c7', 500: '#f79009', 600: '#dc6803', 700: '#b54708' },
        danger: { 50: '#fef3f2', 100: '#fee4e2', 500: '#f04438', 600: '#d92d20', 700: '#b42318' },
        info: { 50: '#eff8ff', 100: '#d1e9ff', 500: '#2e90fa', 600: '#1570ef', 700: '#175cd3' },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(16, 24, 40, 0.05)',
        popover: '0 4px 6px -2px rgba(16, 24, 40, 0.03), 0 12px 16px -4px rgba(16, 24, 40, 0.08)',
        dropdown: '0 4px 6px -2px rgba(16, 24, 40, 0.03), 0 12px 16px -4px rgba(16, 24, 40, 0.08)',
      },
      borderRadius: {
        xl: '0.875rem',
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
      },
    },
  },
  plugins: [],
}
