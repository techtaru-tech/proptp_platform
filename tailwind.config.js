/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Propto's headline face (proptocrm.com) — headings only, body stays Inter.
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // The app shell — Propto's navy (the logo's road and the proptocrm.com header ink is
        // 900, its darkest footer navy is 950), so the sidebar and every dark surface sit in the
        // website's own family.
        shell: {
          50: '#f5f8fb',
          100: '#e2e8ef',
          200: '#c5d1dd',
          300: '#9fb3c8',
          400: '#6f86a0',
          500: '#4f6177',
          600: '#2f4a68',
          700: '#1b4470',
          800: '#0c3560',
          900: '#062645',
          950: '#041a31',
        },
        // Propto primary — the green of proptocrm.com's buttons (#0e7f51 is 600, its hover
        // #0a6a43 is 700, the logo's field green #2bb265 is 500). White on 600 passes contrast,
        // which is what solid buttons and the active nav use.
        brand: {
          50: '#edf9f2',
          100: '#dff5e9',
          200: '#b9e8cc',
          300: '#86d6a7',
          400: '#4fc27f',
          500: '#2bb265',
          600: '#0e7f51',
          700: '#0a6a43',
          800: '#0a5537',
          900: '#08432c',
          950: '#04271a',
        },
        // Propto secondary — the amber highlight of proptocrm.com (#d98e04 is 500). White on
        // 500 is too low-contrast for a filled control, so anything with text on it uses 600
        // or darker.
        accent: {
          50: '#fef8e7',
          100: '#fdeec4',
          200: '#fad98a',
          300: '#f5c04f',
          400: '#eba620',
          500: '#d98e04',
          600: '#9a6203',
          700: '#7d4f06',
          800: '#653f0a',
          900: '#52340d',
          950: '#2e1c05',
        },
        // The lime of the logo's field stripes (#7ab32e is 500). Not a UI colour — it is here
        // so charts, gradients and illustrations can reach for the logo.
        blossom: {
          50: '#f4f9ec',
          100: '#e7f2d6',
          200: '#cfe5ad',
          300: '#b2d47e',
          400: '#95c455',
          500: '#7ab32e',
          600: '#628f25',
          700: '#4a6c1c',
          800: '#3a5516',
          900: '#2b3f10',
        },
        // A lighter step of the logo's navy (#2d6294 is 500), for a cool second neutral.
        steel: {
          200: '#b4c8dc',
          300: '#87a6c4',
          400: '#5a84ac',
          500: '#2d6294',
          600: '#1f4c78',
          700: '#0c3560',
        },
        surface: {
          DEFAULT: '#ffffff',
          subtle: '#f6f7f9',
          muted: '#eef0f3',
        },
        ink: {
          DEFAULT: '#0b1f35',
          muted: '#4f6177',
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
