import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vite is invoked from the repo root, so point Tailwind at this directory's config explicitly.
const here = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: resolve(here, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
