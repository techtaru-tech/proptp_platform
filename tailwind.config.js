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
        // Dark slate — derived from the live ShreeRam Partner site's --bgDark (#0c2239).
        // Used for the sidebar, dark surfaces and high-emphasis dark text.
        navy: {
          50: '#f5f7fa',
          100: '#e7edf4',
          200: '#cbd8e6',
          300: '#a5bcd4',
          400: '#7498be',
          500: '#4b749f',
          600: '#385676',
          700: '#293f57',
          800: '#1a2c3f',
          900: '#0c2239',
          950: '#071522',
        },
        // Brand red — the ShreeRam Group primary (--primary: #C34245 on the live site).
        brand: {
          50: '#faeff0',
          100: '#f5dcdc',
          200: '#eab8b9',
          300: '#dd8d8f',
          400: '#d06264',
          500: '#c53a3d',
          600: '#C34245',
          700: '#86282a',
          800: '#661e20',
          900: '#471516',
          950: '#270c0c',
        },
        // Brand orange — the ShreeRam Group secondary (--secondary: #FF9439 on the live site).
        accent: {
          50: '#fff4eb',
          100: '#ffe6d1',
          200: '#ffcda3',
          300: '#ffaf6b',
          400: '#ff9133',
          500: '#FF9439',
          600: '#d66200',
          700: '#ad5000',
          800: '#853d00',
          900: '#5c2a00',
          950: '#331700',
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
