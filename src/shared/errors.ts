// Return nested errors, including socket errors wrapped in ws ErrorEvent values
export function errorChain(cause: unknown): Error[] {
  // The errors retained in order from the outer failure to its root cause
  const errors: Error[] = [];
  // The next error or WebSocket error event to unwrap
  let current = cause;
  while (current) {
    if (!(current instanceof Error)) {
      // Puppeteer's ws transport rejects with an ErrorEvent containing .error
      if (
        typeof current === 'object' &&
        'error' in current &&
        current.error instanceof Error
      ) {
        current = current.error;
        continue;
      }
      break;
    }
    if (errors.includes(current)) break;
    errors.push(current);
    current = current.cause;
  }
  return errors;
}

// Describe a failure without serializing arbitrary objects or request payloads
export function describeError(cause: unknown): string {
  return (
    errorChain(cause)
      .map((error) => error.message)
      .join(' → ') || (typeof cause === 'string' ? cause : 'Unknown error')
  );
}
