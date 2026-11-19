import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_NAME } from '../shared/protocol.js';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  BROWSERS,
  DEFAULT_DESTINATION,
  DEFAULT_SOURCE,
  isBrowserId,
} from '../shared/browsers.js';

// The app identity used by both the bundle and macOS privacy permission resets
const BUNDLE_ID = 'com.calebevans.chromium-session-transfer.helper';

// Read the identity macOS uses to recognize updates; no bundle means first install
async function signingIdentity(bundle: string): Promise<string | undefined> {
  try {
    await stat(bundle);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw cause;
  }
  // Ad-hoc requirements contain a code hash; certificate identities can remain
  // stable across builds, so compare requirements rather than executable bytes
  const requirement = execFileSync(
    '/usr/bin/codesign',
    ['--display', '--requirements', '-', bundle],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  if (!requirement)
    throw new Error('Could not read the helper signing identity');
  return requirement;
}

// Remove only this helper's stale grants without rebuilding its signed bundle
function resetPermissions(): void {
  execFileSync('/usr/bin/tccutil', ['reset', 'All', BUNDLE_ID], {
    stdio: 'inherit',
  });
}

// Build a native app entry point so macOS can attribute privacy permissions
async function buildBundle(entry: string): Promise<string> {
  // The stable development bundle, separate from the disposable build output
  const bundle = resolve(
    dirname(entry),
    '../../.local/Chromium Session Transfer Helper.app',
  );
  // Remember the installed identity before compilation or signing can replace it
  const previousIdentity = await signingIdentity(bundle);
  // The directory containing the app's native entry point and Node runtime
  const executables = resolve(bundle, 'Contents/MacOS');
  // The directory containing launch paths without any authenticated data
  const resources = resolve(bundle, 'Contents/Resources');
  await mkdir(executables, { recursive: true });
  await mkdir(resources, { recursive: true });
  // The Mach-O executable registered with the source browser
  const launcher = resolve(executables, 'session-transfer-helper');
  // The native launcher source remains in the developer's checkout
  const source = resolve(dirname(entry), '../../src/host/macos/launcher.m');
  execFileSync(
    '/usr/bin/xcrun',
    [
      'clang',
      '-fobjc-arc',
      '-framework',
      'Foundation',
      '-framework',
      'CoreServices',
      source,
      '-o',
      launcher,
    ],
    { stdio: 'inherit' },
  );
  await copyFile(process.execPath, resolve(executables, 'node'));
  await chmod(resolve(executables, 'node'), 0o700);
  await writeFile(
    resolve(resources, 'launch.json'),
    JSON.stringify({ entry }) + '\n',
  );
  await writeFile(
    resolve(bundle, 'Contents/Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
<key>CFBundleExecutable</key><string>session-transfer-helper</string>
<key>CFBundleName</key><string>Chromium Session Transfer Helper</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSUIElement</key><true/>
</dict></plist>
`,
  );
  // Preserve Node's existing signature; seal the outer app for local testing
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle], {
    stdio: 'inherit',
  });
  execFileSync(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', bundle],
    { stdio: 'inherit' },
  );
  // Let macOS resolve the helper by bundle ID when displaying privacy entries
  // A native messaging launch alone does not perform this app registration
  execFileSync(launcher, ['--register'], { stdio: 'inherit' });
  // Reset only after verification and app registration; a failed build must not
  // erase grants, and Launch Services must know the identity being reset
  const currentIdentity = await signingIdentity(bundle);
  if (!currentIdentity) throw new Error('The rebuilt helper bundle is missing');
  if (previousIdentity !== undefined && previousIdentity !== currentIdentity) {
    resetPermissions();
    process.stdout.write(
      'The helper signing identity changed. Reset this helper’s privacy permissions. Quit and reopen System Settings, retry a transfer, then grant destination browser access again in Files & Folders.\n',
    );
  } else {
    process.stdout.write(
      previousIdentity === undefined
        ? 'First installation; no existing privacy permissions were reset. Grant destination browser access when requested.\n'
        : 'The helper signing identity is unchanged; existing privacy permissions were preserved.\n',
    );
  }
  return launcher;
}

// Register an on-demand host in the selected source browser's lookup directory
async function install(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('The MVP installer currently supports macOS only');
  }
  // The source defaults to Brave; the extension ID remains an optional argument
  const { values, positionals } = parseArgs({
    options: {
      source: { type: 'string', default: DEFAULT_SOURCE },
      uninstall: { type: 'boolean', default: false },
      'reset-permissions': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  if (!isBrowserId(values.source) || positionals.length > 1) {
    throw new Error(
      `Usage: pnpm host:install --source <${Object.keys(BROWSERS).join('|')}> [extension-id]`,
    );
  }
  if (values['reset-permissions']) {
    if (values.uninstall) {
      throw new Error('Choose either uninstall or reset-permissions');
    }
    // Reset only this app's grants; do not rebuild it or change its signature
    resetPermissions();
    process.stdout.write(
      'Reset this helper’s privacy permissions. Quit and reopen System Settings, retry a transfer, then grant destination browser access in Files & Folders. The app bundle was not changed.\n',
    );
    return;
  }
  // The selected browser's registration metadata
  const source = BROWSERS[values.source];
  // The directory searched by the source browser for native messaging hosts
  const directory = resolve(
    homedir(),
    'Library/Application Support',
    source.nativeHostDirectory,
    'NativeMessagingHosts',
  );
  // The manifest path belonging exclusively to this project
  const manifestPath = resolve(directory, `${HOST_NAME}.json`);
  if (values.uninstall) {
    await removeRegistration(manifestPath);
    process.stdout.write(
      `Removed the native helper registration for ${source.name}\n`,
    );
    return;
  }
  // The extension ID whose native messages the source browser may deliver
  const extensionId = positionals[0] ?? (await builtExtensionId());
  if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(
      'Supply the extension ID shown in the source browser’s extension details',
    );
  }
  // The compiled helper entry point, kept at a stable path after builds
  const entry = fileURLToPath(new URL('./main.js', import.meta.url));
  await readFile(entry);
  // The native bundle executable that replaces the original shell launcher
  const launcher = await buildBundle(entry);
  await mkdir(directory, { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        name: HOST_NAME,
        description:
          'Transfer selected sessions between running Chromium browsers',
        path: launcher,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${extensionId}/`],
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  await chmod(manifestPath, 0o600);
  process.stdout.write(
    `Registered the on-demand helper for ${source.name}, extension ${extensionId}\nManifest: ${manifestPath}\nHelper: ${launcher}\nChoose the destination in extension settings; it defaults to ${BROWSERS[DEFAULT_DESTINATION].name}.\nNo browser restart is required. Re-run this command if the project moves or to update the bundled Node runtime.\n`,
  );
}

// Remove only this helper's registration; a missing file is already uninstalled
async function removeRegistration(path: string): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

// Derive the unpacked extension's stable ID from its public manifest key
async function builtExtensionId(): Promise<string> {
  // The source manifest whose public key also ships in the extension build
  const manifest = JSON.parse(
    await readFile(
      new URL('../extension/manifest.json', import.meta.url),
      'utf8',
    ),
  ) as { key: string };
  if (!manifest.key)
    throw new Error('Build the extension before installing the helper');
  return [
    ...createHash('sha256')
      .update(Buffer.from(manifest.key, 'base64'))
      .digest()
      .subarray(0, 16),
  ]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join('');
}

void install().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Helper installation failed'}\n`,
  );
  process.exitCode = 1;
});
