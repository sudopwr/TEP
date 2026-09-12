import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The API runs as its own process on 127.0.0.1:3000; this proxy makes it look
 * same-origin to the browser during development.
 *
 * That is not a convenience, it is what makes the session work at all. §5a's
 * cookie is `httpOnly`, `sameSite=lax` and has no domain — a cross-origin
 * `fetch` from `localhost:5173` to `127.0.0.1:3000` would not send it, and
 * every request would 401. Proxying means the browser sees one origin in
 * development and one origin in production, and the cookie rules are the same
 * in both.
 *
 * `127.0.0.1` rather than `localhost` on purpose: `localhost` resolves to ::1
 * first on Windows and Node 18+, the API binds IPv4, and the result is
 * ECONNREFUSED for reasons that take an hour to find.
 */
const API = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],

  server: {
    // N7: loopback only. The dev server has no more business on the network
    // than the API does.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/auth': { target: API, changeOrigin: false },
      '/health': { target: API, changeOrigin: false },
    },
  },

  preview: { host: '127.0.0.1', port: 4173, strictPort: true },

  build: {
    outDir: 'dist',
    // A financial tool that is being audited benefits from a stack trace that
    // points at real lines. Nothing here is secret — it ships to one machine.
    sourcemap: true,
  },
});
