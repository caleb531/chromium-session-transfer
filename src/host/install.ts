import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_NAME } from '../shared/protocol.js';
import { createHash } from 'node:crypto';

// Quote a literal path for the tiny POSIX native host launcher
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// Register an on-demand host for the exact Brave extension ID supplied by the
// user
async function install(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('The MVP installer currently supports macOS only');
  }
  // The user-level native messaging registration read by Brave
  const directory = resolve(
    homedir(),
    'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts',
  );
  // The manifest path belonging exclusively to this project
  const manifestPath = resolve(directory, `${HOST_NAME}.json`);
  if (process.argv.includes('--uninstall')) {
    await unlink(manifestPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
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
  // The project-local executable that selects the current absolute Node binary
  const launcher = resolve(dirname(entry), '../../../.local/native-host');
  await mkdir(dirname(launcher), { recursive: true });
  await writeFile(
    launcher,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(entry)} "$@"\n`,
    { mode: 0o700 },
  );
  await chmod(launcher, 0o700);
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
  process.stdout.write(
    `Registered the on-demand helper for extension ${extensionId}\nNo browser restart is required. Re-run this command if Node or the project moves.\n`,
  );
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
