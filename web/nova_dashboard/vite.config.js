import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // dist/ works from any folder (python -m http.server, nginx, file share)
  define: {
    __NOVA_DEMO__: JSON.stringify(process.env.NOVA_DEMO === '1'),
    __DASH_URL__: JSON.stringify(process.env.NOVA_DASH_URL || './index.html?demo=1'),
  },
  build: {
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, 'index.html'), // control dashboard + 3D twin
        showcase: resolve(__dirname, 'showcase.html'), // 3D project website
      },
    },
  },
});
