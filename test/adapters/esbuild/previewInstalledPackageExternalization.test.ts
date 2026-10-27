/**
 * Verifies the installed-package vendor seam: application imports of plain packages become import
 * map externals, while a package another dependency declares as a peer stays in the bundle so the
 * dependency and the application share one instance.
 */
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewInstalledPackageExternalizationPlugin } from '../../../src/adapters/esbuild/previewInstalledPackageExternalizationPlugin';
import { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('installed package externalization', () => {
  /** A peer of a bundled dependency stays bundled; an unrelated plain package is externalized. */
  it('keeps packages other dependencies declare as peers inside the bundle', async () => {
    const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/externalization-'));
    temporaryRoots.push(root);
    await writePackage(root, 'shared-core', {}, 'export const marker = {};\n');
    await writePackage(
      root,
      'host-ui',
      { 'shared-core': '*' },
      "import { marker } from 'shared-core';\nexport const hostMarker = marker;\n",
    );
    await writePackage(root, 'plain-lib', {}, 'export const plain = 1;\n');
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        dependencies: { 'host-ui': '1.0.0', 'plain-lib': '1.0.0', 'shared-core': '1.0.0' },
        name: 'app',
      }),
    );
    const entryPath = path.join(root, 'app.js');
    await writeFile(
      entryPath,
      [
        "import { hostMarker } from 'host-ui';",
        "import { marker } from 'shared-core';",
        "import { plain } from 'plain-lib';",
        'export const same = hostMarker === marker;',
        'export const value = plain;',
      ].join('\n'),
    );

    const result = await build({
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      logLevel: 'silent',
      metafile: true,
      platform: 'browser',
      plugins: [
        createPreviewInstalledPackageExternalizationPlugin({
          documentPath: entryPath,
          staticModuleResolver: createPreviewStaticModuleResolver({ workspaceRoot: root }),
        }),
      ],
      write: false,
    });
    const externals = Object.values(result.metafile.inputs)
      .flatMap((input) => input.imports)
      .filter((imported) => imported.external === true)
      .map((imported) => imported.path);
    const bundled = Object.keys(result.metafile.inputs);

    expect(externals).toEqual(['plain-lib']);
    expect(bundled.filter((input) => input.includes('node_modules/shared-core/'))).toHaveLength(1);
    expect(bundled.some((input) => input.includes('node_modules/host-ui/'))).toBe(true);
  });
});

/** Writes one ESM package with optional peer dependencies under the fixture's node_modules. */
async function writePackage(
  root: string,
  name: string,
  peerDependencies: Readonly<Record<string, string>>,
  source: string,
): Promise<void> {
  const packageRoot = path.join(root, 'node_modules', name);
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        main: 'index.js',
        name,
        peerDependencies,
        type: 'module',
        version: '1.0.0',
      }),
    ),
    writeFile(path.join(packageRoot, 'index.js'), source),
  ]);
}
