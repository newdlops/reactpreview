/**
 * Creates a platform-tagged VSIX whose manifest matches the installed native esbuild binary.
 * Cross-packaging is rejected because npm installs only the optional esbuild package for the host;
 * release CI should run this script independently on every supported operating system and CPU.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createVSIX } from '@vscode/vsce';

const PROJECT_ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

/**
 * Detects whether a Linux host uses musl and therefore requires an Alpine VS Code target.
 *
 * @returns {boolean} `true` for musl-based Linux and `false` on glibc or non-Linux platforms.
 */
function isMuslLinux() {
  if (process.platform !== 'linux') {
    return false;
  }

  const report = process.report?.getReport();
  return report === undefined || !('glibcVersionRuntime' in report.header);
}

/**
 * Maps the current Node host to VS Code's documented platform-specific extension target.
 *
 * @returns {string} Target identifier that matches npm's installed optional esbuild binary.
 * @throws {Error} When VS Code or esbuild has no supported target for the current host tuple.
 */
function detectCurrentTarget() {
  const baseTarget = `${process.platform}-${process.arch}`;
  const targetByHost = {
    'darwin-arm64': 'darwin-arm64',
    'darwin-x64': 'darwin-x64',
    'linux-arm': 'linux-armhf',
    'linux-arm64': isMuslLinux() ? 'alpine-arm64' : 'linux-arm64',
    'linux-x64': isMuslLinux() ? 'alpine-x64' : 'linux-x64',
    'win32-arm64': 'win32-arm64',
    'win32-x64': 'win32-x64',
  };
  const target = targetByHost[baseTarget];
  if (target === undefined) {
    throw new Error(`Unsupported VSIX host platform: ${baseTarget}`);
  }

  return target;
}

/**
 * Validates the target, calculates a deterministic filename, and invokes VSCE's package API.
 *
 * @returns {Promise<void>} Resolves after a platform-tagged VSIX is written to the project root.
 */
async function packageCurrentPlatform() {
  const currentTarget = detectCurrentTarget();
  const requestedTarget = process.argv[2] ?? currentTarget;
  if (requestedTarget !== currentTarget) {
    throw new Error(
      `Cannot package ${requestedTarget} on ${currentTarget}: install dependencies and run this script on the target platform.`,
    );
  }

  const packageManifest = JSON.parse(
    await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'),
  );
  const outputDirectory =
    process.env.VSIX_OUTPUT_DIR === undefined
      ? PROJECT_ROOT
      : path.resolve(process.env.VSIX_OUTPUT_DIR);
  const packagePath = path.join(
    outputDirectory,
    `${packageManifest.name}-${packageManifest.version}-${currentTarget}.vsix`,
  );

  await createVSIX({
    cwd: PROJECT_ROOT,
    packagePath,
    target: currentTarget,
  });
}

await packageCurrentPlatform();
