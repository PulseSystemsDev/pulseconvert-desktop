module.exports = {
  content: ['./renderer/index.html', './renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { base: '#0a0b0f', surface: '#111319', elevated: '#171a22', hover: '#1c1f27' },
        border: { subtle: '#1b1e27', DEFAULT: '#262a35', strong: '#343947' },
        accent: { orange: '#ff7a33', 'orange-soft': '#ffa06a', 'orange-deep': '#e25d17', teal: '#2dd4bf', 'orange-dim': 'rgba(255,122,51,0.14)' },
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
      // Softly rounded everywhere, same scale as the website: controls 8-10px, panels 12-14px.
      borderRadius: {
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '14px',
        '2xl': '18px',
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
