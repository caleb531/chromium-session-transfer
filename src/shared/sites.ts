import { getDomain } from 'tldts';

// Return the schemeful site Chromium uses to partition top-level cookies
export function cookieSite(url: string): string {
  // The page whose public suffix must not be guessed by splitting dots
  const page = new URL(url);
  return `${page.protocol}//${getDomain(page.hostname, { allowPrivateDomains: true }) ?? page.hostname}`;
}

// Cover parent-domain cookies and both schemes without granting every website
export function cookiePermission(url: string): string {
  // The hostname used to read cookies scoped to its registrable parent domain
  const hostname = new URL(url).hostname;
  // The registrable parent; private suffixes keep hosted tenants separate
  const domain = getDomain(hostname, { allowPrivateDomains: true });
  return `*://${domain ? `*.${domain}` : hostname}/*`;
}

// Check whether a cookie belongs to one of the selected top-level partitions
export function selectedPartition(
  partition:
    { topLevelSite?: string; hasCrossSiteAncestor?: boolean } | undefined,
  sites: string[],
): boolean {
  return (
    !partition ||
    (partition.hasCrossSiteAncestor !== true &&
      partition.topLevelSite !== undefined &&
      sites.includes(partition.topLevelSite))
  );
}
