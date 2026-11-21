import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { roomPages } from './rooms.vite.ts';

const CLOUDFLARE_MAX_ASSET_BYTES = 25 * 1024 * 1024;

function cloudflareAssetLimit(): Plugin {
  return {
    name: 'cloudflare-pages-asset-limit',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'asset') continue;
        const bytes = typeof output.source === 'string'
          ? Buffer.byteLength(output.source)
          : output.source.byteLength;
        if (bytes > CLOUDFLARE_MAX_ASSET_BYTES) {
          this.error(`${output.fileName} is ${bytes} bytes; Cloudflare Pages allows 25 MiB.`);
        }
      }
    },
  };
}

// While developing, the page comes from here so it can update as you edit, and the server answers
// everything else. dev.cmd says which server to use.
export default defineConfig({
  // the Rooms guest page and big-screen display are their own tiny entries (rooms.vite.ts)
  plugins: [react(), roomPages(import.meta.dirname), cloudflareAssetLimit()],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': process.env.SELECTA_API ?? 'http://127.0.0.1:8733' },
    // the feature-flag registry lives with the server, in ../src/selecta/flags, and both read it
    fs: { allow: ['..'] },
  },
});
