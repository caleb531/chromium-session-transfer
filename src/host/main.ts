import { endianness } from 'node:os';
import { importToChrome } from './chrome.js';
import type { HostResult, TransferPayload } from '../shared/protocol.js';
import { describeError } from '../shared/errors.js';
import { logError, logStep } from './log.js';

// The native messaging request size accepted by Chromium
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

// Read one length-prefixed request without creating a credential file
async function readMessage(): Promise<TransferPayload> {
  // The unread bytes received through the native messaging pipe
  let buffer = Buffer.alloc(0);
  // The expected payload length after the four-byte header is received
  let length: number | undefined;
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, chunk]);
    if (length === undefined && buffer.length >= 4) {
      length =
        endianness() === 'LE' ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
      if (!length || length > MAX_MESSAGE_BYTES)
        throw new Error('Invalid native message size');
    }
    if (length !== undefined && buffer.length >= length + 4) {
      return JSON.parse(
        buffer.subarray(4, length + 4).toString('utf8'),
      ) as TransferPayload;
    }
  }
  throw new Error(
    'The extension disconnected before sending a complete request',
  );
}

// Return a credential-free result using Chromium's native framing protocol
function reply(result: HostResult): void {
  // The small status response serialized without any transfer payload values
  const body = Buffer.from(JSON.stringify(result), 'utf8');
  // The native byte-order length prefix required by the browser
  const header = Buffer.alloc(4);
  if (endianness() === 'LE') header.writeUInt32LE(body.length);
  else header.writeUInt32BE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
}

// Handle exactly one transfer and exit after the Chrome connection is detached
async function main(): Promise<void> {
  logStep('Native helper started; waiting for the extension request');
  // The request is kept only in process memory until this helper exits
  let result: HostResult;
  try {
    result = await importToChrome(await readMessage());
  } catch (cause) {
    logError('Native helper request failed', cause);
    result = {
      ok: false,
      message: `The helper could not process this transfer: ${describeError(cause)}`,
    };
  }
  reply(result);
  logStep(
    result.ok
      ? 'Transfer completed; helper exiting'
      : `Transfer failed: ${result.message}`,
  );
}

void main();
