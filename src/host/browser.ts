import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import { BROWSERS } from '../shared/browsers.js';
import type { BrowserId } from '../shared/browsers.js';

// Connect to the chosen running browser without launching or restarting it
export async function connectBrowser(destination: BrowserId): Promise<Browser> {
  // The selected browser's stable data root, shared by its ordinary profiles
  const definition = BROWSERS[destination];
  // The endpoint file maintained by Chromium's remote debugging server
  const path = resolve(
    homedir(),
    'Library/Application Support',
    definition.dataDirectory,
    'DevToolsActivePort',
  );
  // The endpoint file contains a port and browser WebSocket path, not cookies
  let contents: string;
  try {
    contents = await readFile(path, 'ascii');
  } catch (cause) {
    throw new Error(
      `Could not read the debugging endpoint for ${definition.name} at ${path}. Keep it open and enable remote debugging at ${definition.debuggingUrl}`,
      { cause },
    );
  }
  // The two endpoint fields emitted by Chromium
  const [portText, socketPath] = contents.trim().split(/\r?\n/);
  // The loopback port checked before constructing a connection URL
  const port = Number(portText);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !socketPath?.startsWith('/devtools/browser/') ||
    /[\s?#]/.test(socketPath)
  ) {
    throw new Error(
      `Invalid debugging endpoint for ${definition.name}; toggle remote debugging and retry`,
    );
  }
  return puppeteer.connect({
    browserWSEndpoint: `ws://127.0.0.1:${port}${socketPath}`,
    defaultViewport: null,
    protocolTimeout: 30000,
    wsOptions: { handshakeTimeout: 120000 },
    // CDP frames contain session secrets; never enable protocol logging
    logger: () => undefined,
  });
}
