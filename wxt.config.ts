import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'wxt';

// Keep the unpacked extension in the folder used by the browser and helper
export default defineConfig({
  srcDir: 'src/extension',
  outDir: 'dist',
  outDirTemplate: 'extension',
  browser: 'chrome',
  manifestVersion: 3,
  imports: false,
  webExt: { disabled: true },
  dev: { reloadCommand: false },
  vite: () => ({ plugins: [svelte()] }),
  manifest: {
    name: 'Chromium Session Transfer',
    description:
      'Transfer selected tabs and their stored sessions between Chromium browsers',
    minimum_chrome_version: '144',
    permissions: ['tabs', 'cookies', 'scripting', 'storage', 'nativeMessaging'],
    optional_host_permissions: ['*://*/*'],
    icons: {
      16: 'app-icon-16.png',
      32: 'app-icon-32.png',
      48: 'app-icon-48.png',
      128: 'app-icon-128.png',
    },
    action: {
      default_icon: {
        16: 'app-icon-16.png',
        32: 'app-icon-32.png',
      },
    },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+C' },
        description: 'Choose tabs to transfer',
      },
    },
    // The public key that keeps the extension ID stable for native messaging
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyR5UivpIJa2slCySsduvnabylFuJ3q3IIyxmgoZfsTXK7G+wv0HFfObh7bSFOXNIgUF9BlvN4s0mdgjHs90dWRcfYduoUKGoTdMpkLew1Ss5ZSAlY2K6isVDpla45GZjnvn4Bd53wwu1BYCJtdsNB/KVtnAOWWcxkSxkJtjJKuliGYxsQk6AfQPiC7Rc3DLXciT+bTAXFaW1Ut8jTAt6QTyanoSr6b/ganymzsHu0vJVDVPfxrgGXMXL2S+STYjKBykkHLLRBNDQEGWBepOFUC6QG0UYYLQFBq+7dJ6LrUTaDfnDnC7y2amUYeJRE7C9b/j1D0VepA6UZQNiYpLv9QIDAQAB',
  },
});
