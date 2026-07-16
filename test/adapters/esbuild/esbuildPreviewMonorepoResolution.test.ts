/**
 * Verifies package resolution when the preview target belongs to a nested monorepo package.
 * The fixture lives outside this repository so a successful build cannot accidentally obtain
 * React or the fake runtime package from the extension project's own ancestor `node_modules`.
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import type { PreviewBundle } from '../../../src/domain/preview';

const EXTENSION_PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler monorepo package resolution', () => {
  /**
   * Resolves a dependency installed only at the workspace root from a target below
   * `packages/app`. Package-export subpaths intentionally omit file extensions while their
   * mapped files exercise both ESM (`.mjs`) and CommonJS (`.cjs`) dependency entries.
   */
  it('bundles hoisted runtime packages from a nested application target', async () => {
    const temporaryWorkspace = await mkdtemp(
      path.join(tmpdir(), 'react-preview-hoisted-monorepo-'),
    );
    const workspaceRoot = await realpath(temporaryWorkspace);
    const workspaceNodeModules = path.join(workspaceRoot, 'node_modules');
    const applicationRoot = path.join(workspaceRoot, 'packages', 'app');
    const sourceDirectory = path.join(applicationRoot, 'src');
    const documentPath = path.join(sourceDirectory, 'Preview.tsx');
    const runtimePackageRoot = path.join(workspaceNodeModules, 'hoisted-preview-runtime');
    const runtimeDistribution = path.join(runtimePackageRoot, 'dist');
    const runtimeEntryPath = path.join(runtimeDistribution, 'index.mjs');
    const legacyEntryPath = path.join(runtimeDistribution, 'legacy.cjs');
    const sourceText = [
      "import { runtimeLabel } from 'hoisted-preview-runtime';",
      "import legacyLabel from 'hoisted-preview-runtime/legacy';",
      'export default function Preview() {',
      '  return <main>{runtimeLabel}:{legacyLabel}</main>;',
      '}',
    ].join('\n');

    try {
      await Promise.all([
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(runtimeDistribution, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(workspaceRoot, 'package.json'),
          JSON.stringify({ private: true, workspaces: ['packages/*'] }),
          'utf8',
        ),
        writeFile(
          path.join(applicationRoot, 'package.json'),
          JSON.stringify({ name: 'nested-preview-app', private: true }),
          'utf8',
        ),
        writeFile(
          path.join(runtimePackageRoot, 'package.json'),
          JSON.stringify({
            exports: {
              '.': './dist/index.mjs',
              './legacy': './dist/legacy.cjs',
            },
            name: 'hoisted-preview-runtime',
            type: 'module',
            version: '1.0.0',
          }),
          'utf8',
        ),
        writeFile(runtimeEntryPath, "export const runtimeLabel = 'HOISTED_ESM_MARKER';", 'utf8'),
        writeFile(legacyEntryPath, "module.exports = 'HOISTED_CJS_MARKER';", 'utf8'),
        writeFile(documentPath, sourceText, 'utf8'),
      ]);
      await Promise.all([
        linkInstalledPackage('react', workspaceNodeModules),
        linkInstalledPackage('react-dom', workspaceNodeModules),
        linkInstalledPackage('scheduler', workspaceNodeModules),
      ]);

      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot,
      });
      const javascript = decodeBundleJavascript(bundle);

      expect(javascript).toContain('HOISTED_ESM_MARKER');
      expect(javascript).toContain('HOISTED_CJS_MARKER');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([documentPath, legacyEntryPath, runtimeEntryPath]),
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

/**
 * Symlinks one installed extension-development dependency into the isolated workspace fixture.
 * ReactDOM's direct `scheduler` dependency is linked alongside React and ReactDOM so no resolver
 * fallback can reach this repository through a filesystem ancestor.
 *
 * @param packageName Package directory name under the extension project's `node_modules`.
 * @param destinationNodeModules Isolated workspace installation directory receiving the link.
 */
async function linkInstalledPackage(
  packageName: string,
  destinationNodeModules: string,
): Promise<void> {
  const installedPackage = path.join(EXTENSION_PROJECT_ROOT, 'node_modules', packageName);
  const workspacePackage = path.join(destinationNodeModules, packageName);
  await symlink(
    installedPackage,
    workspacePackage,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

/** Decodes the entry plus split chunks because target and dependency markers may be lazy-loaded. */
function decodeBundleJavascript(bundle: PreviewBundle): string {
  const decoder = new TextDecoder();
  return [bundle.javascript, ...bundle.chunks.map((chunk) => chunk.contents)]
    .map((contents) => decoder.decode(contents))
    .join('\n');
}
