// The browser-specific locations needed by discovery and native registration
export interface BrowserDefinition {
  // The browser name displayed in settings and transfer results
  name: string;
  // The stable browser's data directory relative to macOS Application Support
  dataDirectory: string;
  // The data directory where this browser looks for native host manifests
  nativeHostDirectory: string;
  // The browser page where the user can enable remote debugging
  debuggingUrl: string;
}

// The supported browser metadata; transfer logic consumes this shared registry
export const BROWSERS = {
  chrome: {
    name: 'Google Chrome',
    dataDirectory: 'Google/Chrome',
    nativeHostDirectory: 'Google/Chrome',
    debuggingUrl: 'chrome://inspect/#remote-debugging',
  },
  brave: {
    name: 'Brave',
    dataDirectory: 'BraveSoftware/Brave-Browser',
    // Brave deliberately uses Chrome's native messaging directory on macOS
    // https://github.com/brave/brave-core/blob/master/app/brave_main_delegate.cc
    nativeHostDirectory: 'Google/Chrome',
    debuggingUrl: 'brave://inspect/#remote-debugging',
  },
  // The stable Edge installation; native hosts live in its own data root
  edge: {
    name: 'Microsoft Edge',
    dataDirectory: 'Microsoft Edge',
    nativeHostDirectory: 'Microsoft Edge',
    debuggingUrl: 'edge://inspect/#remote-debugging',
  },
  // The regular Opera installation, excluding GX, Air, and Neon
  opera: {
    name: 'Opera',
    dataDirectory: 'com.operasoftware.Opera',
    // Opera documents Chrome's directory for macOS native messaging hosts
    // https://help.opera.com/en/extensions/message-passing/
    nativeHostDirectory: 'Google/Chrome',
    debuggingUrl: 'opera://inspect/#remote-debugging',
  },
  // The unbranded Chromium installation retains the chrome:// internal scheme
  chromium: {
    name: 'Chromium',
    dataDirectory: 'Chromium',
    nativeHostDirectory: 'Chromium',
    debuggingUrl: 'chrome://inspect/#remote-debugging',
  },
} satisfies Record<string, BrowserDefinition>;

// The short browser names accepted by settings, the protocol, and the installer
export type BrowserId = keyof typeof BROWSERS;

// The source used when the installer receives no explicit browser choice
export const DEFAULT_SOURCE: BrowserId = 'brave';

// The destination used by new settings and older saved preferences
export const DEFAULT_DESTINATION: BrowserId = 'chrome';

// Check an external browser name without accepting inherited object properties
export function isBrowserId(value: unknown): value is BrowserId {
  return typeof value === 'string' && Object.hasOwn(BROWSERS, value);
}
