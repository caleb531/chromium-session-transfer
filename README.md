# Chrome Session Transfer

Transfer selected Brave tabs and their stored website state into an already-open
Google Chrome profile. Chrome remains available to Chrome DevTools MCP through
your existing `--autoConnect` configuration.

The MVP targets macOS, Brave with Chromium 144 or newer, Google Chrome 144 or
newer, and Node.js 24 or newer. The implementation is TypeScript, with Svelte
for the extension UI and an on-demand native messaging helper.

## Set up

```sh
pnpm install
pnpm build
pnpm host:install
```

The installer registers the local helper in Brave's user-level
`NativeMessagingHosts` directory. It creates a launcher in `.local/` that uses
the absolute path to the Node executable running the installer. Run the command
again if you move the repository or change Node installations. It does not
launch a browser, create a daemon, or change your Codex configuration.

Load the extension in Brave:

1. Open `brave://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository's `dist/extension` folder.
3. Pin **Chrome Session Transfer** to the toolbar.

The checked-in public manifest key keeps the unpacked extension's ID stable, so
the helper can be registered before you load the extension. No private signing
key is needed or included. You can override the detected extension ID with
`pnpm host:install <extension-id>` if needed.

In Chrome, enable remote debugging at `chrome://inspect/#remote-debugging`.
Keep Chrome open. When a transfer requests a debugging connection, approve it
in Chrome. No browser restart, AppleScript, Chrome extension, or traditional
`--remote-debugging-port` launch is required.

The helper uses `puppeteer-core` to discover and connect to the visible stable
Chrome default profile, using the same connection API as MCP auto-connect. It
does not download a browser or launch a headless browser. Coexistence with an
active MCP connection needs verification on your installed Chrome version. If
Chrome refuses a second connection, disconnect MCP before transferring, then
reconnect it afterward.

## Transfer tabs

1. Click **Send to Chrome**, or press **Option+Shift+C** in Brave.
2. Choose tabs from the picker. Saved domain patterns preselect matching tabs.
3. Click **Send tabs to Chrome** and grant website access when requested.
4. Approve the helper's Chrome connection if prompted.
5. Review the opened pages in Chrome to confirm that the websites accepted the
   transferred sessions.

The picker updates automatically as tabs open, close, navigate, or move. Manual
selections remain intact for tabs that stay on the same origin. **Select all**
checks or unchecks the current filtered list, and Shift-click applies a checkbox
state to the displayed range from the last clicked tab. Updates are deferred
while a transfer is running and applied when it finishes.

Close existing Chrome tabs for the selected sites before transferring. The
helper also refuses to replace cookies used by other open Chrome tabs sharing
their domain scope, or to restore origins with active service/shared workers.
This avoids overwriting storage while those pages or workers are using it.

Selected origins are saved as scheme-specific host patterns. The settings page
supports adding, editing, and deleting patterns such as
`https://*.example.com/*`, `*://example.com/*`, and `http://localhost/*`.
This MVP supports HTTP(S) host patterns with a `/*` path; Chrome host
permissions cover all ports. Deleting a saved pattern removes preselection,
while granted permissions remain manageable in Brave's extension details.

**Transfer Behavior** controls whether Brave tabs stay open or close after the
entire batch has restored storage and reached DOMContentLoaded. The default
keeps them open. A failed batch never intentionally closes Brave tabs. A source
tab that has navigated since capture is also left open. Successful navigation
does not establish successful authentication; use the keep-open setting until
you have verified your sites.

The **Theme** selector on both extension pages offers **System** (the default),
**Dark**, and **Light**. The choice is saved locally and updates other open
extension pages. System mode follows operating-system color scheme changes.

## What is transferred

- Cookies applicable to the selected hosts, including HttpOnly cookies, their
  available security/scope attributes, and their selected top-level partitions.
- localStorage for each selected top-level origin.
- IndexedDB in the default storage bucket for each selected top-level origin,
  including database versions, object stores, indexes, keys, and records.
- sessionStorage captured independently for each selected tab.
- The selected page URLs, opened after all storage restoration completes.

Shared localStorage and IndexedDB are captured once per origin. Cookies are
shared according to their domain/path rather than tab ownership. Parent-domain
cookies can therefore affect multiple accounts or applications on that domain.

### Parent-domain access

Chromium checks cookie API permissions against the cookie's own domain, so
access only to `account.app.netsuite.com` can omit `.netsuite.com` cookies.
The extension requests both-scheme access to the selected host's registrable
domain and subdomains, using the Public Suffix List (including private suffixes)
instead of guessing from the last two hostname labels. This can produce a
broader permission prompt than the selected tab's hostname.

The optional manifest declaration uses `*://*/*` to contain the wildcard-scheme
requests as single patterns. Chromium checks containment against individual
manifest patterns, so separate HTTP and HTTPS declarations do not contain a
single `*://` request even though they cover the same schemes. Actual runtime
requests remain restricted to the selected sites' registrable domains.

The export is still filtered to cookies applicable to the selected hosts and
their top-level cookie partitions. It does not export sibling sites' Web
Storage or IndexedDB. Cookie priority and other metadata not exposed by the
extension cookie API cannot be preserved.

## Restoration and failures

The helper creates intercepted, script-free documents at the selected origins.
It fulfills those bootstrap requests locally; they do not contact the websites.
It captures destination backups in memory, restores each origin's storage,
checks the restored storage against the source snapshot, restores and checks
cookies, and only then navigates to the selected URLs.

Restoration **replaces**, rather than merges, the selected origins' localStorage
and IndexedDB and the affected cookie scopes. This prevents stale destination
authentication data from being mixed with the source session.

If preparation or restoration fails before website navigation, the helper
attempts to restore the destination backups and closes its new tabs. A rollback
failure is reported explicitly. Browser APIs do not provide an atomic
transaction spanning cookies, Web Storage, and multiple IndexedDB databases;
the program cannot promise rollback after a browser/process crash.

After website navigation begins, the server and application may change state.
If navigation fails, the helper keeps the destination tabs for review, keeps
the Brave tabs, and reports that no rollback was attempted.

### IndexedDB support

The serializer preserves shared references and cycles, plain objects, sparse
arrays, undefined, special numeric values, BigInt, Date, RegExp, Map, Set,
ArrayBuffer, the standard integer/float typed arrays, DataView, Blob, File, and
extractable CryptoKey values. Unknown structured value types fail explicitly.

Two important cases stop the batch before destination changes:

- **Non-exportable CryptoKeys:** their private material cannot be extracted.
- **Auto-increment object stores:** IndexedDB does not expose the current key
  generator counter. Recreating records alone can reset it when previously
  generated records have been deleted. The MVP refuses those stores rather
  than silently changing future generated keys.

Other limits:

- Live source pages are not frozen. Each database is read in a consistent
  readonly transaction, but the entire multi-origin snapshot is not atomic.
  Avoid interacting with the selected pages during capture.
- Named storage buckets, Cache Storage, service worker registrations, memory
  state, history, unsaved forms, and browser-managed credentials are not copied.
- Cross-origin frames and automatic SSO dependency discovery are outside scope.
  A provider's cookies or storage are not inferred from an application tab.
- Private and discarded/unloaded tabs are not supported; open unloaded tabs in
  Brave before retrying.
- The in-memory batch must fit Chromium's 64 MiB native messaging request limit.
- Websites can reject copied sessions, expire them, or bind them to credentials
  beyond the transferred stores. Authentication needs verification per site.

## Credentials and persistence

The transfer path uses extension memory, native messaging pipes, Node memory,
and a local CDP connection. There are no credential export files, clipboard
operations, HTTP listeners, cloud services, or persistent queues. Extension
settings contain only domain patterns, transfer behavior, and theme. The native host
returns status only, suppresses Puppeteer's protocol logger, and disconnects
without closing Chrome when finished.

This does not mean credentials can never touch disk: both browser profiles can
persist website storage, and operating-system swap or diagnostics may contain
process memory. JavaScript cannot guarantee immediate erasure of every copied
string. Chrome applies its own normal at-rest storage protection after import;
localStorage and IndexedDB should not be assumed to have cookie encryption.

## Development

```sh
pnpm dev             # Rebuild the extension on changes; reload it in Brave
pnpm build:host      # Recompile the native helper after helper/shared edits
pnpm check           # Check Svelte and TypeScript
pnpm lint            # Run ESLint with Svelte and Prettier integration
pnpm format          # Format source and configuration
pnpm format:check    # Check formatting without editing files
```

There are no automated tests in this iteration. No browser automation has been
used to validate real sessions yet. Build checks establish compilation only;
the first full transfer must verify Chrome/MCP coexistence and your actual
NetSuite and ServiceNow workflows.

```text
src/
  extension/         Background worker, settings, tab selection, and capture
    ui/              Svelte picker/options pages and the two-palette CSS theme
  host/              Native message framing, Chrome restoration, and installer
  shared/            Transfer types, cookie scope rules, and storage serializer
```

The extension is built into `dist/extension`; the Node helper is compiled into
`dist/host`. The old `spawn-sync` install script in the web-extension plugin's
browser-launch dependency tree is explicitly denied: Node already supplies
`spawnSync`, and automatic browser launching is disabled.

To remove the native registration, run `pnpm host:uninstall`. Remove the
extension separately in Brave. Neither action deletes website data already
imported into Chrome.

## License

MIT © 2026 Caleb Evans
