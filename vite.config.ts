import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import webExtension from 'vite-plugin-web-extension';

// Build the unpacked extension without launching or controlling a browser
export default defineConfig({
  plugins: [
    svelte(),
    webExtension({
      disableAutoLaunch: true,
      additionalInputs: ['picker.html'],
    }),
  ],
  build: { outDir: 'dist/extension', emptyOutDir: true },
});
