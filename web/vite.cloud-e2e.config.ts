import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { roomPages } from './rooms.vite.ts';

// Test only: the Cloud site as the cloud browser tests run it (playwright.cloud.config.ts,
// served by tests/e2e_cloud_server.py). It is the real build, with the Rooms guest page and
// display, plus the test harness page (SELECTA_CLOUD_E2E=1), and with AuthKit replaced by
// e2e-cloud/fakeAuthKit.tsx so the tests sign in without WorkOS. It goes to dist-cloud-e2e.
process.env.SELECTA_CLOUD_E2E = '1';
const fake = new URL('./e2e-cloud/fakeAuthKit.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export default defineConfig({
  plugins: [react(), roomPages(import.meta.dirname)],
  resolve: { alias: { '@workos-inc/authkit-react': fake } },
  define: {
    'import.meta.env.VITE_WORKOS_CLIENT_ID': JSON.stringify('client_e2e'),
    'import.meta.env.VITE_WORKOS_API_HOSTNAME': JSON.stringify('auth.e2e.test'),
    'import.meta.env.VITE_CHECKOUT_CONSENT_VERSION': JSON.stringify(''),
  },
  build: { outDir: 'dist-cloud-e2e', emptyOutDir: true },
  server: { fs: { allow: ['..'] } },
});
