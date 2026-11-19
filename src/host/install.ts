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

// Build a native app entry point so macOS can attribute privacy permissions
async function buildBundle(entry: string): Promise<string> {
  // The stable development bundle, separate from the disposable build output
  const bundle = resolve(
    dirname(entry),
    '../../../.local/Chrome Session Transfer Helper.app',
  );
  // The directory containing the app's native entry point and Node runtime
  const executables = resolve(bundle, 'Contents/MacOS');
  // The directory containing launch paths without any authenticated data
  const resources = resolve(bundle, 'Contents/Resources');
  await mkdir(executables, { recursive: true });
  await mkdir(resources, { recursive: true });
  // The Mach-O executable registered with Brave
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
<key>CFBundleIdentifier</key><string>com.calebevans.chrome-session-transfer.helper</string>
<key>CFBundleExecutable</key><string>session-transfer-helper</string>
<key>CFBundleName</key><string>Chrome Session Transfer Helper</string>
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

// Register an on-demand host for the exact Brave extension ID supplied by the
// user
async function install(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('The MVP installer currently supports macOS only');
  }
  // Brave uses Chrome's native messaging directory on macOS
  // See PreSandboxStartup in brave-core/app/brave_main_delegate.cc
  const directory = resolve(
    homedir(),
    'Library/Application Support/Google/Chrome/NativeMessagingHosts',
  );
  // The manifest path belonging exclusively to this project
  const manifestPath = resolve(directory, `${HOST_NAME}.json`);
  // The unused registration created by the original installer
  const legacyManifestPath = resolve(
    homedir(),
    'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts',
    `${HOST_NAME}.json`,
  );
  if (process.argv.includes('--uninstall')) {
    await removeRegistration(manifestPath);
    await removeRegistration(legacyManifestPath);
    process.stdout.write('Removed the Brave native helper registration\n');
    return;
  }
  // The extension ID whose native messages Brave is allowed to deliver
  const extensionId = process.argv[2] ?? (await builtExtensionId());
  if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(
      'Usage: pnpm host:install <extension-id-from-brave://extensions>',
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
          'Transfer selected Brave sessions to an existing Chrome profile',
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
  await removeRegistration(legacyManifestPath);
  process.stdout.write(
    `Registered the on-demand helper for extension ${extensionId}\nManifest: ${manifestPath}\nHelper: ${launcher}\nNo browser restart is required. This development bundle is ad-hoc signed; rebuilding it may require renewed privacy consent. Re-run this command if the project moves or to update the bundled Node runtime.\n`,
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
