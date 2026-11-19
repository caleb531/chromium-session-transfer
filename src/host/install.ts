import {
  chmod,
  copyFile,
  mkdir,
  readFile,
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

// Build a native app entry point so macOS can attribute privacy permissions
async function buildBundle(entry: string): Promise<string> {
  // The stable development bundle, separate from the disposable build output
  const bundle = resolve(
    dirname(entry),
    '../../../.local/Chromium Session Transfer Helper.app',
  );
  // The directory containing the app's native entry point and Node runtime
  const executables = resolve(bundle, 'Contents/MacOS');
  // The directory containing launch paths without any authenticated data
  const resources = resolve(bundle, 'Contents/Resources');
  await mkdir(executables, { recursive: true });
  await mkdir(resources, { recursive: true });
  // The Mach-O executable registered with the source browser
  const launcher = resolve(executables, 'session-transfer-helper');
  // The native launcher source remains in the developer's checkout
  const source = resolve(dirname(entry), '../../../src/host/macos/launcher.m');
  execFileSync(
    '/usr/bin/xcrun',
    ['clang', '-fobjc-arc', '-framework', 'Foundation', source, '-o', launcher],
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
<key>CFBundleIdentifier</key><string>com.calebevans.chromium-session-transfer.helper</string>
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
    },
    allowPositionals: true,
  });
  if (!isBrowserId(values.source) || positionals.length > 1) {
    throw new Error(
      `Usage: pnpm host:install --source <${Object.keys(BROWSERS).join('|')}> [extension-id]`,
    );
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
    `Registered the on-demand helper for ${source.name}, extension ${extensionId}\nManifest: ${manifestPath}\nHelper: ${launcher}\nChoose the destination in extension settings; it defaults to ${BROWSERS[DEFAULT_DESTINATION].name}.\nNo browser restart is required. This development bundle is ad-hoc signed; rebuilding it may require renewed privacy consent. Re-run this command if the project moves or to update the bundled Node runtime.\n`,
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
      new URL('../../extension/manifest.json', import.meta.url),
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
