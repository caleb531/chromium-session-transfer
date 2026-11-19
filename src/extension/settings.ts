// The saved selection rules and behavior preferences; no session data is saved
export interface Settings {
  // The Chrome host match patterns used to preselect tabs
  patterns: string[];
  // Whether to keep Brave tabs after a successful transfer
  behavior: 'keep' | 'close';
  // The chosen color scheme; system follows the operating system preference
  theme: 'system' | 'dark' | 'light';
}

// The defaults used until the user changes the options
export const DEFAULT_SETTINGS: Settings = {
  patterns: [],
  behavior: 'keep',
  theme: 'system',
};

// The saved settings, including arrays serialized as objects by older builds
type StoredSettings = Omit<Partial<Settings>, 'patterns'> & {
  // The domain list or its older numeric-key representation
  patterns?: string[] | Record<string, string>;
};

// Read the preferences without storing any exported website state
export async function readSettings(): Promise<Settings> {
  // The extension's persisted preferences
  const saved = await chrome.storage.local.get<{ settings?: StoredSettings }>(
    'settings',
  );
  return {
    ...DEFAULT_SETTINGS,
    ...saved.settings,
    // Recover the numeric-key objects written from Svelte proxy arrays
    patterns: Object.values(saved.settings?.patterns ?? []),
  };
}

// Save changed preferences without overwriting other open pages' choices
export async function writeSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  // The latest preferences before applying this page's changes
  const current = await readSettings();
  // A plain array prevents Chrome from serializing Svelte proxies as objects
  const settings = {
    ...current,
    ...patch,
    patterns: [...(patch.patterns ?? current.patterns)],
  };
  await chrome.storage.local.set({ settings });
  return settings;
}

// Check the supported HTTP(S) subset of Chrome's host match patterns
export function isPattern(pattern: string): boolean {
  return /^(https?|\*):\/\/(\*|(?:\*\.)?(?:localhost|[a-z\d](?:[a-z\d.-]*[a-z\d])?))\/\*$/i.test(
    pattern,
  );
}

// Check whether a page URL matches a saved Chrome host permission pattern
export function matchesPattern(url: string, pattern: string): boolean {
  // The literal scheme and host parts of a validated pattern
  const [, scheme, host] = /^(\*|https?):\/\/([^/]+)\/\*$/.exec(pattern) ?? [];
  if (!scheme || !host) return false;
  // The URL whose scheme and hostname Chrome host permissions cover
  const page = new URL(url);
  return (
    (scheme === '*' || page.protocol === `${scheme}:`) &&
    (host === '*' ||
      page.hostname === host ||
      (host.startsWith('*.') &&
        (page.hostname === host.slice(2) ||
          page.hostname.endsWith(host.slice(1)))))
  );
}

// Return a scheme-specific host permission; Chrome permissions cover all ports
export function originPattern(url: string): string {
  // The origin selected by the user
  const page = new URL(url);
  return `${page.protocol}//${page.hostname}/*`;
}
