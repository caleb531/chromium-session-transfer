import { FORMAT_VERSION, HOST_NAME } from '../shared/protocol.js';
import type {
  HostResult,
  StorageSnapshot,
  TransferPayload,
} from '../shared/protocol.js';
import { websiteStorage } from '../shared/storage.js';
import { cookieSite, selectedPartition } from '../shared/sites.js';
import { describeError } from '../shared/errors.js';

// Capture every supported store before sending a single payload to the helper
export async function transferTabs(
  tabs: chrome.tabs.Tab[],
  report: (message: string) => void,
): Promise<HostResult> {
  if (!tabs.length) throw new Error('Choose at least one tab');
  // The shared data captured once per top-level origin
  const origins = new Map<string, StorageSnapshot>();
  // The selected pages and their independently captured sessionStorage
  const transferred: TransferPayload['tabs'] = [];
  // The cookie store shared by all selected non-private Brave tabs
  let storeId: string | undefined;
  // The source store membership used to choose the correct browser cookie store
  const stores = await chrome.cookies.getAllCookieStores();
  for (const selected of tabs) {
    // The live tab checked again in case it navigated after the picker opened
    const tab = await chrome.tabs.get(selected.id!);
    if (tab.url !== selected.url || tab.incognito || !tab.url) {
      throw new Error(
        'A selected tab changed or is private; refresh the tab list',
      );
    }
    if (tab.discarded) {
      throw new Error('A selected tab is unloaded; open it in Brave and retry');
    }
    // The cookie store that owns this selected tab
    const store = stores.find((entry) => entry.tabIds.includes(tab.id!));
    if (!store || (storeId !== undefined && storeId !== store.id)) {
      throw new Error('All selected tabs must belong to the same cookie store');
    }
    storeId = store.id;
    // The source origin whose data must be restored before navigation
    const origin = new URL(tab.url).origin;
    report(`Reading tab ${transferred.length + 1} of ${tabs.length}…`);
    // The complete origin snapshot for the first tab, or tab-specific storage
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: websiteStorage,
      args: [origins.has(origin) ? 'read-session' : 'read'],
    });
    // The script result returned across Chromium's extension boundary
    const result = results[0];
    if (!result?.result) {
      throw new Error(
        'Could not capture a selected origin; it may have navigated',
      );
    }
    if (!result.result.ok) throw new Error(result.result.message);
    // The completed storage returned from the source page's isolated world
    const snapshot = result.result.snapshot;
    if (!snapshot || snapshot.origin !== origin)
      throw new Error('A selected tab changed origin during capture');
    if (!origins.has(origin)) origins.set(origin, snapshot);
    transferred.push({
      sourceId: tab.id!,
      url: tab.url,
      title: tab.title ?? origin,
      origin,
      session: snapshot.session,
    });
  }
  report('Reading cookies for the selected origins…');
  // The hosts that actually belong to the selected tabs
  const hosts = transferred.map((tab) => new URL(tab.url).hostname);
  // The schemeful sites whose top-level partitioned cookies are in scope
  const sites = [...new Set(transferred.map((tab) => cookieSite(tab.url)))];
  // The permitted cookies filtered again to exclude unrelated granted domains
  const cookies = (
    await chrome.cookies.getAll({ storeId, partitionKey: {} })
  ).filter((cookie) => {
    // The domain scope recorded by Chromium; a leading dot includes subdomains
    const domain = cookie.domain.replace(/^\./, '');
    return (
      selectedPartition(cookie.partitionKey, sites) &&
      hosts.some((host) =>
        cookie.hostOnly
          ? host === domain
          : host === domain || host.endsWith(`.${domain}`),
      )
    );
  });
  // The complete batch kept only in memory until the native host exits
  const payload: TransferPayload = {
    version: FORMAT_VERSION,
    tabs: transferred,
    origins: [...origins.values()],
    cookies,
  };
  if (
    new TextEncoder().encode(JSON.stringify(payload)).byteLength >
    64 * 1024 * 1024
  ) {
    throw new Error(
      'This batch exceeds native messaging’s 64 MiB limit; choose fewer origins',
    );
  }
  // Recheck source URLs after extraction so stale selections are never closed
  for (const selected of tabs) {
    if ((await chrome.tabs.get(selected.id!)).url !== selected.url) {
      throw new Error('A selected tab navigated during capture; retry');
    }
  }
  report('Waiting for Chrome; approve its connection request if shown…');
  try {
    return (await chrome.runtime.sendNativeMessage(
      HOST_NAME,
      payload,
    )) as HostResult;
  } catch (cause) {
    console.error('[chromium-session-transfer] Native messaging failed', cause);
    throw new Error(`Native helper connection failed: ${describeError(cause)}`);
  }
}
