import { open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import { BROWSERS } from '../shared/browsers.js';
import type { BrowserId } from '../shared/browsers.js';
import { describeError } from '../shared/errors.js';

// The setup result contains permission status only, never browser file contents
export interface BrowserAccessResult {
  // Whether file access is ready, denied, or missing the debugging endpoint
  status: 'ready' | 'permission-required' | 'unavailable';
  // The next setup step or confirmation displayed by the installer
  message: string;
}

// Locate the endpoint used by both permission checks and actual connections
function endpointPath(destination: BrowserId): string {
  return resolve(
    homedir(),
    'Library/Application Support',
    BROWSERS[destination].dataDirectory,
    'DevToolsActivePort',
  );
}

// Request endpoint access under the helper's app identity without reading data
export async function checkBrowserAccess(
  destination: BrowserId,
): Promise<BrowserAccessResult> {
  // The selected destination whose data access macOS should authorize
  const definition = BROWSERS[destination];
  try {
    // Opening read-only triggers the same permission check as discovery; no
    // endpoint bytes or session data are read and no CDP connection is opened
    const file = await open(endpointPath(destination), 'r');
    await file.close();
    return {
      status: 'ready',
      message: `Browser data access is ready for ${definition.name}.`,
    };
  } catch (cause) {
    // Only expected setup conditions become nonfatal installer instructions
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') {
      return {
        status: 'permission-required',
        message: `macOS requires ${definition.name} access. Quit and reopen System Settings, then enable ${definition.name} under Privacy & Security → Files & Folders → Chromium Session Transfer Helper. No transfer attempt is needed. Details: ${describeError(cause)}`,
      };
    }
    if (code === 'ENOENT') {
      return {
        status: 'unavailable',
        message: `The debugging endpoint for ${definition.name} is missing. Keep it open and enable ${definition.debuggingUrl}, then rerun host:install to check access. Details: ${describeError(cause)}`,
      };
    }
    throw cause;
  }
}

// Connect to the chosen running browser without launching or restarting it
export async function connectBrowser(destination: BrowserId): Promise<Browser> {
  // The selected browser's stable data root, shared by its ordinary profiles
  const definition = BROWSERS[destination];
  // The endpoint file maintained by Chromium's remote debugging server
  const path = endpointPath(destination);
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
