import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The approved vector artwork used for both extension and native app icons
const source = fileURLToPath(
  new URL('../public/app-icon.svg', import.meta.url),
);

// The extension sizes referenced by its manifest and page favicons
const extensionSizes = [16, 32, 48, 128];

// The logical macOS icon sizes, each with standard and Retina representations
const macSizes = [16, 32, 128, 256, 512];

// Render each resolution directly from the SVG and package one macOS ICNS
async function generateIcons(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Generating the app ICNS requires macOS iconutil');
  }
  try {
    execFileSync('rsvg-convert', ['--version'], { stdio: 'ignore' });
  } catch (cause) {
    throw new Error(
      'Install librsvg (brew install librsvg) to provide rsvg-convert',
      { cause },
    );
  }
  // Intermediate PNGs are removed even when rendering or packaging fails
  const temporary = await mkdtemp(
    join(tmpdir(), 'chromium-session-transfer-icons-'),
  );
  try {
    // The iconset directory recognized by the macOS packaging tool
    const iconset = join(temporary, 'app-icon.iconset');
    await mkdir(iconset);
    // Render each physical resolution once, including Retina representations
    const sizes = new Set([
      ...extensionSizes,
      ...macSizes,
      ...macSizes.map((size) => size * 2),
    ]);
    for (const size of sizes) {
      execFileSync(
        'rsvg-convert',
        [
          '--width',
          String(size),
          '--height',
          String(size),
          '--output',
          join(temporary, `${size}.png`),
          source,
        ],
        { stdio: 'inherit' },
      );
    }
    for (const size of macSizes) {
      for (const scale of [1, 2]) {
        // Iconset filenames describe logical size and Retina scale separately
        const suffix = scale === 2 ? '@2x' : '';
        await copyFile(
          join(temporary, `${size * scale}.png`),
          join(iconset, `icon_${size}x${size}${suffix}.png`),
        );
      }
    }
    // Package before replacing checked-in assets, so conversion errors leave
    // the previous complete set intact
    const icns = join(temporary, 'app-icon.icns');
    execFileSync(
      '/usr/bin/iconutil',
      ['--convert', 'icns', '--output', icns, iconset],
      { stdio: 'inherit' },
    );
    for (const size of extensionSizes) {
      await copyFile(
        join(temporary, `${size}.png`),
        fileURLToPath(
          new URL(`../public/app-icon-${size}.png`, import.meta.url),
        ),
      );
    }
    await copyFile(
      icns,
      fileURLToPath(
        new URL('../src/host/macos/app-icon.icns', import.meta.url),
      ),
    );
    process.stdout.write(
      'Generated 16, 32, 48, and 128px extension PNGs and the native app ICNS\n',
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

void generateIcons().catch((cause: unknown) => {
  console.error(cause);
  process.exitCode = 1;
});
