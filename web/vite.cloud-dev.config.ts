/** Local Cloud development: the real Cloud API, local identity, disk objects and test Stripe.
 *
 * The AuthKit React alias is intentionally limited to this config. Production and
 * real-AuthKit browser tests continue to import @workos-inc/authkit-react itself.
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { roomPages } from './rooms.vite.ts';

const localAuth = fileURLToPath(new URL('./src/cloud/devAuthKit.tsx', import.meta.url));
const api = process.env.SELECTA_DEV_API_URL ?? 'http://127.0.0.1:8733';
const identity = process.env.SELECTA_DEV_IDENTITY_URL ?? 'http://127.0.0.1:8742';

export default defineConfig({
  plugins: [react(), roomPages(import.meta.dirname)],
  resolve: { alias: { '@workos-inc/authkit-react': localAuth } },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '/api': api,
      '/dev/stack': api,
      '/dev-objects': api,
      '/dev-stripe': api,
      '/user_management': identity,
      '/dev/mail': identity,
      '/dev/identity': identity,
      '/sso/jwks': identity,
    },
    fs: { allow: ['..'] },
  },
});
