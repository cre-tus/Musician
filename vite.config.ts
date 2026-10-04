import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' : Electron production loads dist/index.html over file://,
// so asset URLs must be relative.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
