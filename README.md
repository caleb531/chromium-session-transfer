# Chromium Session Transfer

Transfer selected tabs and their stored website state between running Chromium
browsers. The source is whichever browser runs the extension; choose the
destination in the picker or Settings. The defaults remain Brave → Google Chrome.

The MVP targets macOS, Chromium 144 or newer, and Node.js 24 or newer. Browser
definitions currently cover stable Brave and Google Chrome; other browsers need
verified metadata before being added. Brave → Chrome has been verified with
NetSuite and ServiceNow. Brave as a destination and Chrome as a source still
need end-to-end verification. The transfer engine is shared across destinations.

## Set up

```sh
pnpm install
pnpm build
pnpm host:install
```

`host:install` defaults to Brave as the source. To select it explicitly, or to
register for Chrome as a source:

```sh
pnpm host:install --source brave
pnpm host:install --source chrome --target brave
```

The installer registers the helper where the **source** browser looks for native
hosts. The actual transfer destination is saved in the extension and can change
without reinstallation. The optional `--target` selects which destination's
permissions to check during setup; it defaults to Chrome and does not change
the extension's saved destination. Both current browser definitions use
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`. Brave on
macOS deliberately reads Chrome's registration directory; see
[Brave's startup code](https://github.com/brave/brave-core/blob/master/app/brave_main_delegate.cc).
The directory is created if needed even if Chrome is not installed. Since both
browsers share this registration path and the extension key, one registration
can serve both; uninstalling it removes the helper registration for both.

The installer builds `.local/Chromium Session Transfer Helper.app`
using the installed Apple Command Line Tools. The app contains a small native
launcher and a copy of the Node executable running the installer; the compiled
TypeScript and dependencies still run from this checkout. Run the command again
if you move the repository or want to update its Node runtime. It does not
launch a browser, create a daemon, or change your Codex configuration.

The installer also registers the signed app with macOS Launch Services, so
system components can find it by bundle ID when displaying privacy entries.
It then launches the app in the background through Launch Services for a
read-only access check against the target's `DevToolsActivePort` file. The check
opens and closes the file without reading its contents or connecting to CDP.
The app's access attempt lets macOS create the Files & Folders entry during
setup; registration alone does not create a permission request. If access is
blocked, the installer tells you to quit and reopen System Settings and enable
the target under the helper. No failed transfer is needed. Keep the target open
with remote debugging enabled so its endpoint exists; a missing endpoint is
reported separately. Neither registration nor the check grants access for you.

The development bundle is ad-hoc signed, with Node's original signature retained.
The installer compares signing identities before and after rebuilding. If an
existing helper's identity changed, it automatically resets only this helper's
privacy approvals and tells you to grant destination access again. If the
identity is unchanged or this is the first installation, no approvals are reset.
Build, signature verification, or app registration failures do not trigger a
reset. Each destination may need its own data-access grant; a valid signature
alone does not establish permission. Public distribution will need a
self-contained helper, a stable signing identity, and notarization.

Ordinary `pnpm build` and `pnpm build:host` commands update code outside the
bundle; they do not rebuild or sign the app. Only `pnpm host:install` rebuilds
the bundle, copies the current Node runtime, and signs it. Use it after changing
the native launcher or bundle metadata, upgrading the bundled Node runtime, or
moving the checkout. Extension and TypeScript transfer changes normally need
only a build (and an extension reload when its code changes).

For manual recovery from a stale privacy grant, run:

```sh
pnpm host:reset-permissions
# Or check another destination after resetting:
pnpm host:reset-permissions --target brave
```

This resets only the helper's macOS privacy approvals, including any destination
browser grants. It does not rebuild the app, grant access, or reset other apps.
After resetting, it runs the same access check to create the destination's
permission entry again. Quit and reopen System Settings to refresh the list,
then enable the destination in Files & Folders. The tool prints this reminder
when access is denied; it does not quit System Settings for you. This is an
explicit recovery command; normal installation handles identity changes
automatically. A reset never grants access on your behalf.

Load the extension in the **source** browser:

1. Open `brave://extensions` or `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository's `dist/extension` folder.
3. Pin **Chromium Session Transfer** to the toolbar.

The checked-in public manifest key keeps the unpacked extension's ID stable, so
the helper can be registered before you load the extension. No private signing
key is needed or included. You can override the detected extension ID with
`pnpm host:install --source brave <extension-id>` if needed.

Keep the destination browser open and enable remote debugging at
`chrome://inspect/#remote-debugging` or `brave://inspect/#remote-debugging`.
Settings shows the instructions for the selected destination. Approve its
connection request if shown. No destination extension is needed. The no-restart
connection workflow has been verified in Chrome; browser/version support for
the same debugging setup must be checked before relying on another destination.

The helper reads `DevToolsActivePort` from the selected browser's stable data
root and connects through `puppeteer-core`. It restores into the default browser
context, not an incognito context. Named/custom data roots are outside this MVP.
It does not download or launch a browser. If an active MCP connection prevents
another connection, disconnect MCP before transferring and reconnect afterward.
Chrome remains available to MCP through your existing `--autoConnect` setup.

macOS may block endpoint discovery with a **Data Access Blocked** notification.
The bundle is meant
to attribute this access to **Chromium Session Transfer Helper** rather than your
general-purpose Node installation. Review **System Settings → Privacy & Security
→ Files & Folders** for the actual requesting identity and grant the destination
browser's
access if available. If the request still appears as **node**, record that
along with the error; don't assume bundling has fixed attribution. This is
separate from the destination's remote-debugging permission. The helper does not
change macOS privacy settings. Connection failures include their underlying
cause so a permission denial is distinguishable from a transport failure.

## Transfer tabs

1. Click **Transfer sessions**, or press **Option+Shift+C** in the source browser.
2. Choose the destination and tabs. Saved domain patterns preselect matching tabs.
3. Click the Send button and grant website access when requested.
4. Approve the destination's debugging connection if prompted.
5. Review the destination pages to confirm that the websites accepted the
   transferred sessions.

The picker updates automatically as tabs open, close, navigate, or move. Manual
selections remain intact for tabs that stay on the same origin. **Select all**
checks or unchecks the current filtered list, and Shift-click applies a checkbox
state to the displayed range from the last clicked tab. Updates are deferred
while a transfer is running and applied when it finishes.

Close existing destination tabs for the selected sites before transferring. The
helper also refuses to replace cookies used by other open destination tabs sharing
their domain scope, or to restore origins with active service/shared workers.
This avoids overwriting storage while those pages or workers are using it.
Selecting the same browser/profile that owns the source tabs is therefore
rejected by the same open-tab guard; the helper never closes those source tabs
to make the check pass.

Selected origins are saved as scheme-specific host patterns. The settings page
supports adding, editing, and deleting patterns such as
`https://*.example.com/*`, `*://example.com/*`, and `http://localhost/*`.
This MVP supports HTTP(S) host patterns with a `/*` path; Chromium host
permissions cover all ports. Deleting a saved pattern removes preselection,
while granted permissions remain manageable in the source's extension details.

**Transfer Behavior** controls whether source tabs stay open or close after the
entire batch has restored storage and reached DOMContentLoaded. The default
keeps them open. A failed batch never intentionally closes source tabs. A source
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
the source tabs, and reports that no rollback was attempted.

### IndexedDB support

The serializer preserves shared references and cycles, plain objects, sparse
arrays, undefined, special numeric values, BigInt, Date, RegExp, Map, Set,
ArrayBuffer, the standard integer/float typed arrays, DataView, Blob, File, and
extractable CryptoKey values. Unknown structured value types fail explicitly.

Auto-increment stores preserve their next generated key, including counters
ahead of surviving records and exhausted generators. Capture reads records and
probes each generator in the same transaction, then deliberately aborts before
any probe can commit. Stores with generators require a read/write transaction;
aborting restores both records and counters. Restoration advances each new
store's generator using a temporary record deleted before real records are
inserted. Readback verification includes the generator state.

Non-exportable CryptoKeys still stop the batch before destination changes;
their private material cannot be extracted.

Other limits:

- Live source pages are not frozen. Each database is read in a consistent
  transaction, but the entire multi-origin snapshot is not atomic.
  Avoid interacting with the selected pages during capture.
- Named storage buckets, Cache Storage, service worker registrations, memory
  state, history, unsaved forms, and browser-managed credentials are not copied.
- Cross-origin frames and automatic SSO dependency discovery are outside scope.
  A provider's cookies or storage are not inferred from an application tab.
- Private and discarded/unloaded tabs are not supported; open unloaded tabs in
  the source browser before retrying.
- The in-memory batch must fit Chromium's 64 MiB native messaging request limit.
- Websites can reject copied sessions, expire them, or bind them to credentials
  beyond the transferred stores. Authentication needs verification per site.

## Credentials and persistence

The transfer path uses extension memory, native messaging pipes, Node memory,
and a local CDP connection. There are no credential export files, clipboard
operations, HTTP listeners, cloud services, or persistent queues. Extension
settings contain only the destination, domain patterns, transfer behavior, and theme. The native host
returns status only, suppresses Puppeteer's protocol logger, and disconnects
without closing the destination when finished.

This does not mean credentials can never touch disk: both browser profiles can
persist website storage, and operating-system swap or diagnostics may contain
process memory. JavaScript cannot guarantee immediate erasure of every copied
string. The destination applies its normal at-rest storage protection after import;
localStorage and IndexedDB should not be assumed to have cookie encryption.

## Development

```sh
pnpm dev             # Rebuild the extension on changes; reload it in the source
pnpm build:host      # Recompile the native helper after helper/shared edits
pnpm check           # Check Svelte and TypeScript
pnpm lint            # Run ESLint with Svelte and Prettier integration
pnpm format          # Format source and configuration
pnpm format:check    # Check formatting without editing files
pnpm icons:generate # Generate extension PNGs and the helper's macOS ICNS
```

Icon generation uses `public/app-icon.svg` as the single artwork source. It
requires macOS and `rsvg-convert` from librsvg (`brew install librsvg`); macOS
supplies `iconutil`. The script renders 16, 32, 48, and 128px PNGs into `public/`
and packages the standard and Retina macOS sizes into one
`src/host/macos/app-icon.icns`. Intermediate images are temporary and deleted.
After changing artwork, run `pnpm icons:generate` and `pnpm build`, then reload
the extension. Run `pnpm host:install` to update the bundle's icon too; if its
identity changes, the installer resets only the helper's privacy grants and
prints instructions for granting access again.

The picker writes progress and failure details to its DevTools console. The
native helper writes timestamped stages and error stacks (including nested
causes) to stderr, which the browser handles as native-host diagnostic output.
Stdout is reserved for native-message framing. On-screen failures include the
underlying cause. Neither logger dumps transfer payloads or CDP traffic, and
the transfer flow creates no log files. Installation temporarily captures only
the access check's status JSON and startup diagnostics in a private directory,
then deletes it; no browser file contents or session data enter those files.

There is no automated test suite in this iteration. Disposable Chrome databases
have verified IndexedDB counter capture, restoration, and rollback. Real Brave →
Chrome transfers have been accepted by NetSuite and ServiceNow. A new source or
destination still needs end-to-end verification; build checks alone do not
establish session acceptance or debugging compatibility.

```text
src/
  extension/         Background worker, settings, tab selection, and capture
    ui/              Svelte picker/options pages and the two-palette CSS theme
  host/              Native framing, browser discovery, restoration, and installer
  shared/            Browser registry, transfer types, cookie scope, and serializer
```

Build output mirrors the source directories; Vite bundles shared code into the
extension, while the Node helper imports the emitted shared modules:

```text
dist/
  extension/         Bundled extension pages and background worker
  host/              Compiled native helper and installer
  shared/            Compiled shared modules used by the native helper
```

The old `spawn-sync` install script in the web-extension plugin's
browser-launch dependency tree is explicitly denied: Node already supplies
`spawnSync`, and automatic browser launching is disabled.

To remove the registration, run `pnpm host:uninstall --source brave` (or
`--source chrome`). Brave remains the default when omitted. Remove the extension
separately in its source browser. Neither action deletes imported website data.

## License

MIT © 2026 Caleb Evans
