import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The proxy follows the server port so a second dev pair can run on spare ports (`SYNAPSE_PORT=4320 vite --port 5180`).
const serverPort = process.env['SYNAPSE_PORT'] ?? '4317';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
});
