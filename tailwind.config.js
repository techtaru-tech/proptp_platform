/** @type {import('tailwindcss').Config} */
// Every colour is a CSS variable (src/styles/tokens.css), so light and dark are one switch on <html>.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Propto's headline face (proptocrm.com) — page titles only, body stays Inter.
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        // IDs, references and anything read digit by digit.
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        shell: { 50: 'var(--c-shell-50)', 100: 'var(--c-shell-100)', 200: 'var(--c-shell-200)', 300: 'var(--c-shell-300)', 400: 'var(--c-shell-400)', 500: 'var(--c-shell-500)', 600: 'var(--c-shell-600)', 700: 'var(--c-shell-700)', 800: 'var(--c-shell-800)', 900: 'var(--c-shell-900)', 950: 'var(--c-shell-950)' },
        brand: { 50: 'var(--c-brand-50)', 100: 'var(--c-brand-100)', 200: 'var(--c-brand-200)', 300: 'var(--c-brand-300)', 400: 'var(--c-brand-400)', 500: 'var(--c-brand-500)', 600: 'var(--c-brand-600)', 700: 'var(--c-brand-700)', 800: 'var(--c-brand-800)', 900: 'var(--c-brand-900)', 950: 'var(--c-brand-950)' },
        accent: { 50: 'var(--c-accent-50)', 100: 'var(--c-accent-100)', 200: 'var(--c-accent-200)', 300: 'var(--c-accent-300)', 400: 'var(--c-accent-400)', 500: 'var(--c-accent-500)', 600: 'var(--c-accent-600)', 700: 'var(--c-accent-700)', 800: 'var(--c-accent-800)', 900: 'var(--c-accent-900)', 950: 'var(--c-accent-950)' },
        blossom: { 50: 'var(--c-blossom-50)', 100: 'var(--c-blossom-100)', 200: 'var(--c-blossom-200)', 300: 'var(--c-blossom-300)', 400: 'var(--c-blossom-400)', 500: 'var(--c-blossom-500)', 600: 'var(--c-blossom-600)', 700: 'var(--c-blossom-700)', 800: 'var(--c-blossom-800)', 900: 'var(--c-blossom-900)' },
        steel: { 200: 'var(--c-steel-200)', 300: 'var(--c-steel-300)', 400: 'var(--c-steel-400)', 500: 'var(--c-steel-500)', 600: 'var(--c-steel-600)', 700: 'var(--c-steel-700)' },
        success: { 50: 'var(--c-success-50)', 100: 'var(--c-success-100)', 500: 'var(--c-success-500)', 600: 'var(--c-success-600)', 700: 'var(--c-success-700)' },
        warning: { 50: 'var(--c-warning-50)', 100: 'var(--c-warning-100)', 500: 'var(--c-warning-500)', 600: 'var(--c-warning-600)', 700: 'var(--c-warning-700)' },
        danger: { 50: 'var(--c-danger-50)', 100: 'var(--c-danger-100)', 500: 'var(--c-danger-500)', 600: 'var(--c-danger-600)', 700: 'var(--c-danger-700)' },
        info: { 50: 'var(--c-info-50)', 100: 'var(--c-info-100)', 500: 'var(--c-info-500)', 600: 'var(--c-info-600)', 700: 'var(--c-info-700)' },
        surface: { DEFAULT: 'var(--c-surface)', subtle: 'var(--c-surface-subtle)', muted: 'var(--c-surface-muted)' },
        ink: { DEFAULT: 'var(--c-ink)', muted: 'var(--c-ink-muted)', subtle: 'var(--c-ink-subtle)', faint: 'var(--c-ink-faint)' },
        line: { DEFAULT: 'var(--c-line)', strong: 'var(--c-line-strong)' },
      },
      // Hairline borders do the separating; a shadow is kept only for things that float.
      boxShadow: {
        card: '0 0 0 0 transparent',
        popover: '0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 24px -6px rgba(16, 24, 40, 0.14)',
        dropdown: '0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 24px -6px rgba(16, 24, 40, 0.14)',
      },
      // Small and consistent: 4px chips, 6px controls, 8px panels.
      borderRadius: {
        sm: '0.25rem',
        md: '0.3125rem',
        lg: '0.375rem',
        xl: '0.5rem',
        '2xl': '0.5rem',
      },
      // Dense by default: 13px body, 12.5px tables and controls.
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.71875rem', { lineHeight: '1rem' }],
        sm: ['0.78125rem', { lineHeight: '1.125rem' }],
        base: ['0.8125rem', { lineHeight: '1.25rem' }],
        lg: ['0.9375rem', { lineHeight: '1.375rem' }],
        xl: ['1.125rem', { lineHeight: '1.5rem' }],
        '2xl': ['1.375rem', { lineHeight: '1.75rem' }],
        '3xl': ['1.75rem', { lineHeight: '2.125rem' }],
      },
    },
  },
  plugins: [],
}
