import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111318',
        brand: { DEFAULT: '#1E9B45', dark: '#177a37', light: '#E8F5EC' },
        code: { DEFAULT: '#F2C21B', light: '#FFF6D6' },
        alert: { DEFAULT: '#C8202C', light: '#FBE9EA' },
        slate: { DEFAULT: '#24272C', light: '#3A3E45' },
      },
      fontFamily: { sans: ['Manrope', 'system-ui', 'sans-serif'] },
      minHeight: { tap: '48px' },
      minWidth: { tap: '48px' },
    },
  },
  plugins: [],
} satisfies Config;
