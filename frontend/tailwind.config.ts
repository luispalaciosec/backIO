import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta de estados (docs/06). Nunca rojo en el portal.
        estado: { completado: '#0B7A3B', proceso: '#0073EA', pendiente: '#C4C4C4', espera: '#FDAB3D' },
        brand: { DEFAULT: '#0073EA', dark: '#0056B3' },
      },
    },
  },
  plugins: [],
} satisfies Config;
