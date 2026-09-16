/** @type {import('tailwindcss').Config} */
export default {
  // `relative: true` resolves these globs against this file, not the process working directory —
  // the build runs from the repo root (`vite build --config web/vite.config.ts`).
  content: {
    relative: true,
    files: ['./index.html', './src/**/*.{ts,tsx}', '../ui/src/**/*.{ts,tsx}'],
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
