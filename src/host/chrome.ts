import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import puppeteer from 'puppeteer-core';
import type {
  Browser,
  CDPSession,
  HTTPRequest,
  Page,
  Protocol,
} from 'puppeteer-core';
import { FORMAT_VERSION } from '../shared/protocol.js';
import type {
  HostResult,
  StorageSnapshot,
  TransferPayload,
} from '../shared/protocol.js';
import { websiteStorage } from '../shared/storage.js';
import { cookieSite, selectedPartition } from '../shared/sites.js';
import { describeError, errorChain } from '../shared/errors.js';
import { logError, logStep } from './log.js';

// Check whether a cookie's domain scope includes the given hostname
function matchesCookie(host: string, domain: string): boolean {
  return domain.startsWith('.')
    ? host === domain.slice(1) || host.endsWith(domain)
    : host === domain;
}

// Convert extension cookie attributes into CDP's cookie input format
function cookieInput(
  cookie: chrome.cookies.Cookie,
): Protocol.Network.CookieParam {
  if (cookie.partitionKey && !cookie.partitionKey.topLevelSite) {
    throw new Error('A partitioned cookie has an opaque partition key');
  }
  return {
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    ...(cookie.hostOnly
      ? {
          url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${cookie.path}`,
        }
      : { domain: cookie.domain }),
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(cookie.session ? {} : { expires: cookie.expirationDate }),
    ...(cookie.sameSite === 'unspecified'
      ? {}
      : {
          sameSite: { no_restriction: 'None', lax: 'Lax', strict: 'Strict' }[
            cookie.sameSite
          ] as Protocol.Network.CookieSameSite,
        }),
    ...(cookie.partitionKey
      ? {
          partitionKey: {
            topLevelSite: cookie.partitionKey.topLevelSite!,
            hasCrossSiteAncestor:
              cookie.partitionKey.hasCrossSiteAncestor ?? false,
          },
        }
      : {}),
  };
}

// Preserve the extra cookie metadata available in a Chrome rollback checkpoint
function checkpointCookie(
  cookie: Protocol.Network.Cookie,
): Protocol.Network.CookieParam {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    priority: cookie.priority,
    sourceScheme: cookie.sourceScheme,
    sourcePort: cookie.sourcePort,
    partitionKey: cookie.partitionKey,
    ...(cookie.session ? {} : { expires: cookie.expires }),
  };
}

// Check the trusted extension's batch before allowing destination mutations
function validatePayload(payload: TransferPayload): void {
  if (
    payload.version !== FORMAT_VERSION ||
    !payload.tabs?.length ||
    !Array.isArray(payload.origins) ||
    !Array.isArray(payload.cookies)
  ) {
    throw new Error(
      'The helper and extension formats do not match; rebuild and reload',
    );
  }
  // The exact origins exported by the selected source tabs
  const origins = new Set(payload.origins.map((origin) => origin.origin));
  if (origins.size !== payload.origins.length)
    throw new Error('Duplicate origin snapshots');
  for (const tab of payload.tabs) {
    // The selected URL checked against its claimed storage owner
    const url = new URL(tab.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== tab.origin ||
      url.username ||
      url.password ||
      !origins.has(tab.origin) ||
      !Array.isArray(tab.session)
    ) {
      throw new Error(
        'The transfer contains an invalid tab or missing origin snapshot',
      );
    }
  }
  if (origins.size !== new Set(payload.tabs.map((tab) => tab.origin)).size) {
    throw new Error('The transfer contains unselected origins');
  }
  for (const cookie of payload.cookies) {
    if (
      !payload.tabs.some((tab) =>
        matchesCookie(
          new URL(tab.url).hostname,
          cookie.hostOnly ? cookie.domain.replace(/^\./, '') : cookie.domain,
        ),
      )
    ) {
      throw new Error(
        'The transfer contains cookies outside the selected hosts',
      );
    }
    cookieInput(cookie);
  }
}

// Read a destination snapshot and surface serialized browser-side failures
async function readStorage(page: Page): Promise<StorageSnapshot> {
  // The browser-side result contains no hidden thrown-script errors
  const result = await page.evaluate(websiteStorage, 'read' as const);
  if (!result.ok) throw new Error(result.message);
  if (!result.snapshot)
    throw new Error('Destination storage returned no snapshot');
  return result.snapshot;
}

// Restore one origin and require every database transaction to complete
async function restoreStorage(
  page: Page,
  snapshot: StorageSnapshot,
): Promise<void> {
  // The completion status returned after all browser storage writes
  const result = await page.evaluate(
    websiteStorage,
    'write' as const,
    snapshot,
  );
  if (!result.ok) throw new Error(result.message);
}

// Create a real-origin document without contacting the website or running its
// code
async function preparePage(browser: Browser, origin: string): Promise<Page> {
  // The destination page remains script-free until every store is restored
  const page = await browser.newPage();
  try {
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    // The unique main-document request fulfilled locally by the helper
    const bootstrapUrl = `${origin}/.well-known/chromium-session-transfer/${randomUUID()}`;
    // Fulfill only the bootstrap document; no website request is sent in this
    // phase
    const intercept = (request: HTTPRequest): void => {
      if (request.isInterceptResolutionHandled()) return;
      void (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        request.url() === bootstrapUrl
          ? request.respond({
              status: 200,
              contentType: 'text/html',
              headers: {
                'Cache-Control': 'no-store',
                'Content-Security-Policy':
                  "default-src 'none'; frame-ancestors 'none'",
              },
              body: '<!doctype html><title>Preparing session transfer</title><p>Restoring stored session…</p>',
            })
          : request.abort()
      ).catch((cause: unknown) =>
        logError('Bootstrap request interception failed', cause),
      );
    };
    page.on('request', intercept);
    await page.goto(bootstrapUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    return page;
  } catch (cause) {
    await page
      .close()
      .catch((error: unknown) =>
        logError('Could not close a failed bootstrap page', error),
      );
    throw new Error(
      'Could not prepare a destination origin without running website code',
      { cause },
    );
  }
}

// Remove cookies in the selected domain scopes without clearing unrelated sites
async function clearCookies(
  session: CDPSession,
  page: Page,
  domains: string[],
  sites: string[],
): Promise<void> {
  // The current default-profile cookies, kept inside the native helper
  const { cookies } = await session.send('Storage.getCookies');
  // Chromium exposes Network commands on page targets, not the browser target
  const network = await page.createCDPSession();
  try {
    for (const cookie of cookies) {
      if (
        !domains.includes(cookie.domain) ||
        !selectedPartition(cookie.partitionKey, sites)
      )
        continue;
      await network.send('Network.deleteCookies', {
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        partitionKey: cookie.partitionKey,
      });
    }
  } finally {
    await network
      .detach()
      .catch((error: unknown) =>
        logError(
          'Could not detach the cookie deletion debugging session',
          error,
        ),
      );
  }
}

// Restore supported stored state before allowing the destination pages to load
export async function importToChrome(
  payload: TransferPayload,
): Promise<HostResult> {
  validatePayload(payload);
  // The browser connection is detached at the end; Chrome itself stays open
  let browser: Browser;
  logStep('Connecting to the existing Chrome default profile');
  try {
    browser = await puppeteer.connect({
      channel: 'chrome',
      defaultViewport: null,
      protocolTimeout: 30000,
      wsOptions: { handshakeTimeout: 120000 },
      // Suppress protocol logging because CDP messages contain session secrets
      logger: () => undefined,
    });
  } catch (cause) {
    logError('Chrome connection failed', cause);
    for (const error of errorChain(cause)) {
      // The filesystem error code wrapped by Puppeteer's discovery error
      const code = (error as NodeJS.ErrnoException).code;
      // File-open denials need different guidance from denied socket connections
      const syscall = (error as NodeJS.ErrnoException).syscall;
      if (
        process.platform === 'darwin' &&
        syscall === 'open' &&
        (code === 'EPERM' || code === 'EACCES')
      ) {
        return {
          ok: false,
          message: `macOS denied the helper access while discovering Chrome. Review Google Chrome access for Chromium Session Transfer Helper (or node, if that is the identity macOS shows) under System Settings → Privacy & Security → Files & Folders. Details: ${describeError(cause)}`,
        };
      }
    }
    return {
      ok: false,
      message: `Could not connect to Chrome: ${describeError(cause)}`,
    };
  }
  // The new destination pages owned by this batch
  const pages: Page[] = [];
  // The original stored state retained in memory for rollback before navigation
  const backups = new Map<string, { page: Page; snapshot: StorageSnapshot }>();
  // The origins whose restoration has begun and may require rollback
  const touched = new Set<string>();
  // The cookie checkpoint taken before any values are changed
  let previousCookies: Protocol.Network.Cookie[] = [];
  // The exact cookie domain scopes replaced by this operation
  let domains: string[] = [];
  // Whether any cookie mutation has begun
  let cookiesTouched = false;
  // Whether live website code may already have run and changed server state
  let navigating = false;
  // The selected top-level cookie partitions; unrelated partitions stay
  // untouched
  const sites = [...new Set(payload.tabs.map((tab) => cookieSite(tab.url)))];
  // The debugging session used only for cookie operations
  let session: CDPSession | undefined;
  // The current phase used in errors without printing exported records
  let phase = 'checking the destination';
  logStep(phase);
  try {
    session = await browser.target().createCDPSession();
    // The live default-profile cookies before replacing the selected scopes
    const existingCookies = (await session.send('Storage.getCookies')).cookies;
    // The hosts represented by the selected source pages
    const hosts = payload.tabs.map((tab) => new URL(tab.url).hostname);
    domains = [
      ...new Set([
        ...payload.cookies.map((cookie) => cookie.domain),
        ...existingCookies
          .filter((cookie) =>
            hosts.some((host) => matchesCookie(host, cookie.domain)),
          )
          .map((cookie) => cookie.domain),
      ]),
    ];
    previousCookies = existingCookies.filter(
      (cookie) =>
        domains.includes(cookie.domain) &&
        selectedPartition(cookie.partitionKey, sites),
    );
    // The origins whose shared storage will be replaced
    const origins = new Set(payload.origins.map((entry) => entry.origin));
    for (const page of await browser.pages()) {
      if (!/^https?:\/\//.test(page.url())) continue;
      // The open page that could race storage restoration or share replaced
      // cookies
      const url = new URL(page.url());
      if (
        origins.has(url.origin) ||
        domains.some((domain) => matchesCookie(url.hostname, domain))
      ) {
        return {
          ok: false,
          message: `Close Chrome tabs at ${url.origin} before retrying; that site shares storage or cookies with this transfer. Nothing was imported`,
        };
      }
    }
    for (const target of browser.targets()) {
      if (
        !['service_worker', 'shared_worker'].includes(target.type()) ||
        !/^https?:\/\//.test(target.url())
      )
        continue;
      if (origins.has(new URL(target.url()).origin)) {
        return {
          ok: false,
          message:
            'A Chrome background worker is active for a selected origin. Close that site and wait for its worker to stop before retrying; nothing was imported',
        };
      }
    }
    phase = 'preparing destination pages';
    logStep(phase);
    for (const tab of payload.tabs)
      pages.push(await preparePage(browser, tab.origin));
    phase = 'capturing destination backups';
    logStep(phase);
    for (const origin of payload.origins) {
      // The first script-free tab for this shared origin
      const page =
        pages[payload.tabs.findIndex((tab) => tab.origin === origin.origin)];
      backups.set(origin.origin, {
        page,
        snapshot: await readStorage(page),
      });
    }
    phase = 'restoring website storage';
    logStep(phase);
    for (const origin of payload.origins) {
      touched.add(origin.origin);
      await restoreStorage(backups.get(origin.origin)!.page, origin);
      // The readback detects schema, record, or Web Storage differences early
      const restored = await readStorage(backups.get(origin.origin)!.page);
      // Extension and CDP transports can return object properties in different
      // orders; compare their contents while preserving array and graph order
      // The storage section named in an error without including its contents
      for (const section of [
        'origin',
        'local',
        'session',
        'databases',
      ] as const) {
        if (!isDeepStrictEqual(restored[section], origin[section])) {
          throw new Error(
            `Destination website storage did not match the source snapshot (${section})`,
          );
        }
      }
    }
    for (let index = 0; index < pages.length; index++) {
      // The separate sessionStorage entries for this destination tab
      const entries = payload.tabs[index].session;
      await pages[index].evaluate((session) => {
        sessionStorage.clear();
        for (const [key, value] of session) sessionStorage.setItem(key, value);
      }, entries);
      // The per-tab readback checks that sessionStorage was restored separately
      const restored = await pages[index].evaluate(
        websiteStorage,
        'read-session' as const,
      );
      if (
        !restored.ok ||
        !isDeepStrictEqual(restored.snapshot?.session, entries)
      ) {
        throw new Error(
          'Destination sessionStorage did not match its source tab',
        );
      }
    }
    phase = 'restoring cookies';
    logStep(phase);
    cookiesTouched = true;
    await clearCookies(session, pages[0], domains, sites);
    await session.send('Storage.setCookies', {
      cookies: payload.cookies.map(cookieInput),
    });
    // The cookies read back to detect values rejected by Chrome before
    // navigation
    const restored = (await session.send('Storage.getCookies')).cookies;
    for (const cookie of payload.cookies) {
      if (!cookie.session && cookie.expirationDate! <= Date.now() / 1000)
        continue;
      if (
        !restored.some(
          (entry) =>
            entry.name === cookie.name &&
            entry.domain === cookie.domain &&
            entry.path === cookie.path &&
            entry.value === cookie.value &&
            entry.secure === cookie.secure &&
            entry.httpOnly === cookie.httpOnly &&
            entry.session === cookie.session &&
            entry.sameSite === cookieInput(cookie).sameSite &&
            (cookie.session ||
              Math.abs(entry.expires - cookie.expirationDate!) < 1) &&
            entry.partitionKey?.topLevelSite ===
              cookie.partitionKey?.topLevelSite &&
            (entry.partitionKey?.hasCrossSiteAncestor ?? false) ===
              (cookie.partitionKey?.hasCrossSiteAncestor ?? false),
        )
      ) {
        throw new Error('Chrome rejected a cookie');
      }
    }
    phase = 'opening transferred pages';
    logStep(phase);
    navigating = true;
    for (let index = 0; index < pages.length; index++) {
      await pages[index].setRequestInterception(false);
      pages[index].removeAllListeners('request');
      await pages[index].setBypassServiceWorker(false);
      await pages[index].goto(payload.tabs[index].url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
    }
    logStep(`Opened ${pages.length} destination tabs`);
    return {
      ok: true,
      count: pages.length,
      message: `Restored stored state and opened ${pages.length} ${pages.length === 1 ? 'tab' : 'tabs'} in Chrome. Check the websites to confirm their sessions were accepted`,
    };
  } catch (cause) {
    logError(`Transfer failed while ${phase}`, cause);
    if (navigating) {
      return {
        ok: false,
        message: `Stored state was restored, but at least one page failed to load. Brave tabs were kept; destination tabs remain in Chrome for review. No rollback was attempted after website navigation began. Details: ${describeError(cause)}`,
      };
    }
    // Whether every attempted rollback operation completed successfully
    let rolledBack = true;
    for (const origin of touched) {
      // The original storage and the script-free document used to restore it
      const backup = backups.get(origin)!;
      try {
        await restoreStorage(backup.page, backup.snapshot);
      } catch (error) {
        logError(`Storage rollback failed for ${origin}`, error);
        rolledBack = false;
      }
    }
    if (cookiesTouched && session) {
      try {
        await clearCookies(session, pages[0], domains, sites);
        await session.send('Storage.setCookies', {
          cookies: previousCookies.map(checkpointCookie),
        });
      } catch (error) {
        logError('Cookie rollback failed', error);
        rolledBack = false;
      }
    }
    for (const page of pages)
      await page
        .close()
        .catch((error: unknown) =>
          logError('Could not close a destination page after rollback', error),
        );
    return {
      ok: false,
      message: `Transfer failed while ${phase}. Brave tabs were kept. ${rolledBack ? 'Destination changes were rolled back before website navigation' : 'Some destination state could not be rolled back; review Chrome before retrying'}. Details: ${describeError(cause)}`,
    };
  } finally {
    await session
      ?.detach()
      .catch((error: unknown) =>
        logError('Could not detach the cookie debugging session', error),
      );
    await browser.disconnect();
  }
}
