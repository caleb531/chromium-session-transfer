import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// The temporary destination document copied beside this module during builds
export const LOADING_PAGE = await readFile(
  new URL('./loading-page.html', import.meta.url),
  'utf8',
);

// The exact stylesheet text, including whitespace, used for the CSP hash
const styles = LOADING_PAGE.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (styles === undefined) {
  throw new Error('The loading page must contain a <style> element');
}

// Allow only this stylesheet; scripts and external resources remain blocked
export const LOADING_PAGE_CSP = `default-src 'none'; frame-ancestors 'none'; style-src 'sha256-${createHash('sha256').update(styles).digest('base64')}'`;
