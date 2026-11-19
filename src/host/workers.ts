import type { Browser } from 'puppeteer-core';

// The maximum wait for existing workers to stop before any data is replaced
const WORKER_WAIT_MS = 60_000;

// A short quiet interval catches worker replacement during a stop event
const WORKER_QUIET_MS = 250;

// Wait for selected-origin workers; return whether waiting was necessary
export function waitForWorkers(
  browser: Browser,
  origins: Set<string>,
  report: (remaining: number) => void,
  timeoutMs = WORKER_WAIT_MS,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    // Whether a worker has delayed this transfer
    let waited = false;
    // The last count reported, so unrelated target events don't repeat messages
    let previousCount = -1;
    // The pending confirmation that no replacement worker has appeared
    let quiet: ReturnType<typeof setTimeout> | undefined;

    // Remove timers and listeners on success, timeout, or disconnection
    function cleanup(): void {
      clearTimeout(deadline);
      clearTimeout(quiet);
      browser.off('targetcreated', check);
      browser.off('targetchanged', check);
      browser.off('targetdestroyed', check);
      browser.off('disconnected', disconnected);
    }

    // Stop waiting immediately if the destination browser disconnects
    function disconnected(): void {
      cleanup();
      reject(
        new Error(
          'The destination browser disconnected while waiting for background workers',
        ),
      );
    }

    // Count the worker types and origins blocked by the original guard
    function activeWorkers(): number {
      return browser
        .targets()
        .filter(
          (target) =>
            ['service_worker', 'shared_worker'].includes(target.type()) &&
            /^https?:\/\//.test(target.url()) &&
            origins.has(new URL(target.url()).origin),
        ).length;
    }

    // Recheck the live target list after every worker lifecycle event
    function check(): void {
      if (!browser.connected) {
        disconnected();
        return;
      }
      // The current number of matching workers, excluding unrelated targets
      const count = activeWorkers();
      if (count > 0) {
        clearTimeout(quiet);
        quiet = undefined;
        waited = true;
        if (count !== previousCount) {
          previousCount = count;
          report(count);
        }
      } else if (!waited) {
        cleanup();
        resolve(false);
      } else if (quiet === undefined) {
        quiet = setTimeout(() => {
          quiet = undefined;
          if (activeWorkers() === 0) {
            cleanup();
            resolve(true);
          } else {
            check();
          }
        }, WORKER_QUIET_MS);
      }
    }

    // Subscribe before the first scan so the final worker can't stop unnoticed
    browser.on('targetcreated', check);
    browser.on('targetchanged', check);
    browser.on('targetdestroyed', check);
    browser.on('disconnected', disconnected);
    // The deadline bounds the wait even if workers continually restart
    const deadline = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Background workers for selected sites did not become idle within ${timeoutMs / 1000} seconds. Close those sites in the destination browser and retry`,
        ),
      );
    }, timeoutMs);
    check();
  });
}
