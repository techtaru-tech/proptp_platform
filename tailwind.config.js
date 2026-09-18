/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // The app shell — a plum-tinted dark neutral rather than a true grey, so the
        // sidebar and every dark surface sit in the same family as the Rosium primary
        // instead of reading as a second, unrelated brand colour.
        shell: {
          50: '#f8f5f8',
          100: '#efe8ee',
          200: '#ddd0da',
          300: '#c2aebe',
          400: '#a0869b',
          500: '#80687b',
          600: '#665061',
          700: '#4e3c4a',
          800: '#382837',
          900: '#231021',
          950: '#160a15',
        },
        // Rosium primary — #652251, the plum of the ROSIUM wordmark's second half.
        // 600 is the exact brand value; it is what solid buttons and active nav use.
        brand: {
          50: '#faf1f6',
          100: '#f3e0ec',
          200: '#e7c2da',
          300: '#d29ac0',
          400: '#b56b9d',
          500: '#7a2a62',
          600: '#652251',
          700: '#531b42',
          800: '#411534',
          900: '#300f26',
          950: '#1d0917',
        },
        // Rosium secondary — #2596BE. White on 500 is too low-contrast for a filled
        // control, so anything with text on it uses 600 or darker.
        accent: {
          50: '#eff9fd',
          100: '#d8f0f9',
          200: '#b2e1f2',
          300: '#7dcbe7',
          400: '#47b0d6',
          500: '#2596BE',
          600: '#1f7ca0',
          700: '#1d6581',
          800: '#1e536a',
          900: '#1d465a',
          950: '#0f2c3c',
        },
        // The vivid pink of the mark and the "ROS" half of the wordmark. Not a UI colour —
        // it is here so charts and illustrations can reach for the logo's own accent.
        blossom: {
          50: '#fdf0f6',
          100: '#fce0ec',
          200: '#f9c1da',
          300: '#f28fbc',
          400: '#e85398',
          500: '#D4166C',
          600: '#b90f5c',
          700: '#98104d',
          800: '#7d1241',
          900: '#69143a',
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
