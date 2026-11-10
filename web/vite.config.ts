import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { roomPages } from './rooms.vite';

// While developing, the page comes from here so it can update as you edit, and the server answers
// everything else. dev.cmd says which server to use.
export default defineConfig({
  // the Rooms guest page and big-screen display are their own tiny entries (rooms.vite.ts)
  plugins: [react(), roomPages(__dirname)],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': process.env.SELECTA_API ?? 'http://127.0.0.1:8733' },
    // the feature-flag registry lives with the server, in ../src/selecta/flags, and both read it
    fs: { allow: ['..'] },
  },
});
