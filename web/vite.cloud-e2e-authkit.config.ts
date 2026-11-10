import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Test only: the Cloud site with the real @workos-inc/authkit-react, for the sign-in redirect test
// (e2e-cloud/sign-in.cloud.ts, SC-0400-05). Unlike vite.cloud-e2e.config.ts nothing is swapped:
// sign-in goes to the configured auth domain, https://auth.e2e.test, which the test routes to the
// fake AuthKit in tests/e2e_cloud_authkit.py. The test server serves this build at
// http://localhost:<port>. It goes to dist-cloud-e2e-authkit.
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_WORKOS_CLIENT_ID': JSON.stringify('client_e2e'),
    'import.meta.env.VITE_WORKOS_API_HOSTNAME': JSON.stringify('auth.e2e.test'),
    'import.meta.env.VITE_CHECKOUT_CONSENT_VERSION': JSON.stringify(''),
  },
  build: { outDir: 'dist-cloud-e2e-authkit', emptyOutDir: true },
});
