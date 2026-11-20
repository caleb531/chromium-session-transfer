# Chromium Session Transfer

_Copyright 2026 Caleb Evans_  
_Released under the MIT license_

Transfer selected tabs and their stored sessions between running Chromium
browsers. By default, the extension sends tabs from Brave to Google Chrome,
including cookies, localStorage, IndexedDB, and per-tab sessionStorage.

Brave → Google Chrome has been verified with NetSuite and ServiceNow. Other
configured browsers and transfer directions have not yet been verified end to
end.

## Development setup

### Prerequisites

- macOS; the native helper installer currently supports macOS only
- Node.js 24 or newer and pnpm (the project pins pnpm 12.8.1)
- Apple Command Line Tools
- Source and destination browsers from the table below, using Chromium 144 or
  newer for this workflow

If Apple Command Line Tools are not installed, run:

```sh
xcode-select --install
```

### Clone and build

```sh
git clone https://github.com/caleb531/chromium-session-transfer.git
cd chromium-session-transfer
pnpm install
pnpm build
```

Keep the checkout and its dependencies in place: the installed helper runs code
from this directory.

### Prepare the destination browser

For the default Brave → Chrome workflow:

1. Open Google Chrome.
2. Visit `chrome://inspect/#remote-debugging`.
3. Enable **Allow remote debugging for this browser instance**.
4. Leave Chrome open.

Only the source browser needs the extension. Chrome may ask you to approve the
debugging connection when you transfer tabs.

### Install the local helper and grant access

From the repository directory, run:

```sh
pnpm host:install
```

This installs the helper for Brave and checks access to Google Chrome. No server
needs to stay running; the helper starts automatically when you send tabs.

If the installer reports that access is blocked:

1. Quit System Settings completely and reopen it to refresh the permission list.
2. Open **Privacy & Security → Files & Folders**.
3. Expand **Chromium Session Transfer Helper** and enable **Google Chrome**.

Keep Chrome open with remote debugging enabled during installation so the access
check can run. You may also need to approve website access in Brave and the
debugging connection in Chrome when you first transfer tabs.

### Load the extension into the source browser

1. In Brave, open `brave://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select **`dist/extension`** inside this checkout.
4. Pin **Chromium Session Transfer** to the toolbar.

No browser restart is normally needed.

## Using the extension

1. Log into the websites you want to transfer in the source browser.
2. Close destination tabs for those sites, including tabs that share their
   parent-domain cookies. Transferring replaces the selected destination state.
3. Click the extension's toolbar icon, or press **Option+Shift+C**, to open the
   tab picker.
4. Choose the destination browser and select the tabs to send. Search by title
   or URL; the header checkbox selects the filtered list, and Shift-click selects
   a range. The list updates automatically as tabs change.
5. Click **Send … tabs to Google Chrome** (or the selected destination).
6. Allow website access in the source browser if prompted, and approve the
   destination's debugging connection if prompted.
7. Check the opened destination pages to confirm that the websites accepted the
   transferred sessions.

Keep the picker open while the transfer runs and avoid interacting with the
selected source tabs. Progress and errors appear above the submit button.

By default, a successful transfer closes the picker and keeps the original
source tabs open. A failed transfer leaves the picker open so you can read the
error. Keep the originals until you have confirmed that your sites work in the
destination.

### Settings

Open **Settings** from the picker to change:

- **Destination browser:** saved for future transfers; also selectable in the
  picker
- **Transfer Behavior:** keep source tabs open (the default), or close them after
  a successful transfer
- **Close the picker after a successful transfer:** enabled by default; disable
  it to keep successful results visible
- **Saved domain patterns:** add, edit, or delete patterns that preselect tabs,
  such as `https://*.example.com/*`, `*://example.com/*`, or `http://localhost/*`

Selected tab origins are added to the saved patterns when you send them. Patterns
control preselection; they do not prevent you from selecting other sites.
Deleting a pattern does not revoke website permissions already granted to the
extension; manage those in the source browser's extension details.

The **Theme** selector offers **System** (the default), **Dark**, and **Light**.

Website access is requested dynamically and normally persists after approval.
The prompt can cover a selected site's parent domain and subdomains because
shared authentication cookies may belong to that parent domain.

## Changing browsers

The **source** is the browser where you load and use the extension. The
**destination** is selected in the picker or Settings.

Use these browser IDs with `--source` and `--target`:

| Browser        | ID         | Load the extension at | Enable destination debugging at      |
| -------------- | ---------- | --------------------- | ------------------------------------ |
| Google Chrome  | `chrome`   | `chrome://extensions` | `chrome://inspect/#remote-debugging` |
| Brave          | `brave`    | `brave://extensions`  | `brave://inspect/#remote-debugging`  |
| Microsoft Edge | `edge`     | `edge://extensions`   | `edge://inspect/#remote-debugging`   |
| Opera          | `opera`    | `opera://extensions`  | `opera://inspect/#remote-debugging`  |
| Chromium       | `chromium` | `chrome://extensions` | `chrome://inspect/#remote-debugging` |

These entries cover standard installations (stable channels where applicable),
not Beta/Dev/Canary channels or Opera GX, Air, and Neon. Destination use requires
the **Allow remote debugging for this browser instance** checkbox. If your browser
version does not offer that checkbox, its registry entry alone does not enable
it as a destination. Opera's checkbox workflow remains unverified.

```sh
# Default: use the extension in Brave and check Chrome access
pnpm host:install --source brave --target chrome

# Use the extension in Chrome and check Brave access
pnpm host:install --source chrome --target brave

# Use the extension in Edge and check Chromium access
pnpm host:install --source edge --target chromium
```

`--source` chooses where to register the native messaging helper. The optional
`--target` chooses which browser's macOS access to check during installation;
it defaults to `chrome`. **It does not change the extension's destination.**
Choose that separately in the picker or Settings.

Load `dist/extension` in the source browser using its extensions page from the
table. Keep the destination open with remote debugging enabled, and grant that
browser access under the helper in Files & Folders.

Browser locations and setup instructions follow the
[Edge native messaging guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging),
[Edge debugging guide](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/devtools-mcp-server),
[Opera native messaging guide](https://help.opera.com/en/extensions/message-passing/),
[Opera profile guidance](https://blogs.opera.com/desktop/2023/08/resolving-profile-loss-issues-in-opera-version-102-0-4880-16/),
[Chromium data directory documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md),
and [Chromium native messaging guide](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

Use the browsers' standard installations and regular profiles. Custom data
directories, incognito destinations, and transferring into the same
browser/profile as the source are not supported.

## Working on the project

```sh
pnpm dev             # Watch and rebuild the extension
pnpm build:host      # Compile the helper and shared Node modules
pnpm build           # Build both the extension and helper
pnpm check           # Check Svelte and TypeScript
pnpm lint            # Run ESLint
pnpm format:check    # Check formatting
pnpm format          # Apply formatting
```

After rebuilding picker or Settings code or assets, refresh or reopen the
affected tab. For manifest or background service worker changes, click **Reload**
on the extension's card in the source browser's extensions page. Helper changes
take effect on the next transfer after compiling. For native messaging protocol
changes, build both sides and refresh the picker.

Routine builds preserve the installed helper and its permissions. Run
`pnpm host:install` again after moving the checkout, changing the native launcher
or helper icon, updating Node, or removing the helper registration. Reinstallation
may require granting browser access again in Files & Folders. Follow the
installer's instructions.

### Regenerate icons

Edit `public/app-icon.svg`, then run:

```sh
pnpm icons:generate
pnpm build
```

Install `librsvg` with `brew install librsvg` before generating icons. Reload the
extension and run `pnpm host:install` to apply the updated icons. Ordinary builds
use the checked-in assets and do not need icon-generation tools.

## Troubleshooting

- **Native messaging host not found or helper disconnected:** run `pnpm build`
  followed by `pnpm host:install --source brave` (or `--source chrome`). Confirm
  that you loaded `dist/extension` from this checkout. If you moved the project,
  reinstall the helper to update its absolute paths.
- **macOS denied access / `EPERM`:** enable the destination under **System
  Settings → Privacy & Security → Files & Folders → Chromium Session Transfer
  Helper**. Quit and reopen System Settings if its list is stale. If a grant
  still fails, run `pnpm host:reset-permissions` (or add `--target brave`), then
  reopen System Settings and grant access again. This resets only this helper's
  privacy approvals and checks access again without rebuilding the app.
- **Debugging endpoint missing or connection failed:** keep the destination open
  with remote debugging enabled, and approve its connection request. If an active
  MCP connection prevents another connection, disconnect it and retry.
- **Close destination tabs before retrying:** another destination tab uses
  storage or cookies that this transfer would replace. Close the named tabs;
  parent-domain cookies can make a related subdomain count too.
- **Background workers did not stop:** close the site's destination tabs and
  retry. The helper waits automatically, but fails without importing anything if
  matching workers remain active after 60 seconds.

Detailed progress and errors are also available in the picker's DevTools console.

## Limitations

Only the selected pages' sites are transferred; separate SSO providers and
embedded sites are not included automatically. Unsaved forms, password-manager
entries, device-bound credentials, and offline caches are not transferred.
Private or unloaded source tabs are unsupported; load unloaded tabs before
sending them. Some websites may still require you to sign in again.

## Uninstall

```sh
pnpm host:uninstall --source brave
```

Choose the appropriate `--source` for your browser. Remove the extension
separately in the source browser. Brave, Chrome, and Opera share the helper
registration on macOS, so uninstalling for any of them removes that shared
registration. Imported website data is kept.

See [LICENSE.txt](LICENSE.txt) for the MIT license.
