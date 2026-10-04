module.exports = {
  content: ['./renderer/index.html', './renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { base: '#111112', surface: '#161618', elevated: '#1d1d20', hover: '#242428' },
        border: { subtle: '#232326', DEFAULT: '#2c2c30', strong: '#3b3b41' },
        accent: { orange: '#f07b3f', teal: '#4fb3a6', 'orange-dim': 'rgba(240,123,63,0.12)' },
        status: {
          success: { DEFAULT: '#5fae6e', bg: 'rgba(95,174,110,0.12)', border: 'rgba(95,174,110,0.3)' },
          danger: { DEFAULT: '#d9685b', bg: 'rgba(217,104,91,0.12)', border: 'rgba(217,104,91,0.3)' },
          warning: { DEFAULT: '#d9a93f', bg: 'rgba(217,169,63,0.12)', border: 'rgba(217,169,63,0.3)' },
          info: { DEFAULT: '#5b9fd9', bg: 'rgba(91,159,217,0.12)', border: 'rgba(91,159,217,0.3)' },
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['IBM Plex Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'Consolas', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: 'none',
        'glow-lg': 'none',
        panel: '0 12px 32px rgba(0,0,0,0.45)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in': { from: { opacity: '0', transform: 'translateX(24px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        'rise': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out',
        'slide-in': 'slide-in 0.22s cubic-bezier(0.16,1,0.3,1)',
        rise: 'rise 0.22s cubic-bezier(0.16,1,0.3,1)',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
