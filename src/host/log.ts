import { describeError, errorChain } from '../shared/errors.js';

// Write a credential-free progress message outside the native stdout protocol
export function logStep(message: string): void {
  process.stderr.write(
    `[chrome-session-transfer] ${new Date().toISOString()} ${message}\n`,
  );
}

// Log error stacks and causes without dumping CDP or native-message objects
export function logError(message: string, cause: unknown): void {
  logStep(message);
  process.stderr.write(
    errorChain(cause)
      .map((error) => error.stack ?? error.message)
      .join('\nCaused by: ') || describeError(cause),
  );
  process.stderr.write('\n');
}
