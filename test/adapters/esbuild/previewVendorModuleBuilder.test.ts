/** Verifies vendor facades preserve the package boundary that owns each preview target. */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Metafile } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewGlobalPackageBridgePlan } from '../../../src/adapters/esbuild/globalPackageBridge';
import { PreviewVendorModuleBuilder } from '../../../src/adapters/esbuild/previewVendorModuleBuilder';
import type { PreviewBundle } from '../../../src/domain/preview';

const PACKAGE_NAME = 'preview-nested-package';
const APPLICATION_SOURCE = `import { marker } from ${JSON.stringify(PACKAGE_NAME)}; globalThis.__previewMarker = marker;`;
const EMPTY_GLOBAL_PACKAGE_PLAN = createPreviewGlobalPackageBridgePlan({ candidates: [] });

describe('PreviewVendorModuleBuilder', () => {
  /** Resolves and caches one bare package from the nearest monorepo application, not its root. */
  it('keeps nested project package resolution isolated per application root', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-vendor-monorepo-'));
    const firstProjectRoot = path.join(workspaceRoot, 'apps', 'first');
    const secondProjectRoot = path.join(workspaceRoot, 'apps', 'second');
    try {
      await Promise.all([
        writeProjectPackage(firstProjectRoot, 'first-project-marker'),
        writeProjectPackage(secondProjectRoot, 'second-project-marker'),
      ]);
      const builder = new PreviewVendorModuleBuilder();

      const first = await builder.prepare({
        bundle: createApplicationBundle(),
        globalPackagePlan: EMPTY_GLOBAL_PACKAGE_PLAN,
        metafile: createApplicationMetafile(),
        nodePaths: [],
        projectRoot: firstProjectRoot,
        workspaceRoot,
      });
      const second = await builder.prepare({
        bundle: createApplicationBundle(),
        globalPackagePlan: EMPTY_GLOBAL_PACKAGE_PLAN,
        metafile: createApplicationMetafile(),
        nodePaths: [],
        projectRoot: secondProjectRoot,
        workspaceRoot,
      });

      expect(first.moduleImports?.map(({ specifier }) => specifier)).toEqual([PACKAGE_NAME]);
      expect(decodeJavaScriptChunks(first)).toContain('first-project-marker');
      expect(decodeJavaScriptChunks(first)).not.toContain('second-project-marker');
      expect(second.moduleImports?.map(({ specifier }) => specifier)).toEqual([PACKAGE_NAME]);
      expect(decodeJavaScriptChunks(second)).toContain('second-project-marker');
      expect(decodeJavaScriptChunks(second)).not.toContain('first-project-marker');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Keeps bare Node built-ins inside the owned shim namespace for CommonJS vendor dependencies. */
  it('bundles CommonJS vendor packages that require Node built-ins', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-vendor-builtins-'));
    const projectRoot = path.join(workspaceRoot, 'apps', 'web');
    const packageName = 'preview-server-vendor-package';
    const packageLink = path.join(projectRoot, 'node_modules', packageName);
    const packageRoot = path.join(
      workspaceRoot,
      'node_modules',
      '.pnpm',
      `${packageName}@1.0.0`,
      'node_modules',
      packageName,
    );
    const applicationSource = `import value from ${JSON.stringify(packageName)}; globalThis.__previewValue = value;`;
    try {
      await mkdir(packageRoot, { recursive: true });
      await mkdir(path.dirname(packageLink), { recursive: true });
      await Promise.all([
        writeFile(
          path.join(projectRoot, 'package.json'),
          `${JSON.stringify({ name: 'web', private: true })}\n`,
          'utf8',
        ),
        writeFile(
          path.join(packageRoot, 'package.json'),
          `${JSON.stringify({ browser: { fs: false, path: false }, main: 'index.js', name: packageName })}\n`,
          'utf8',
        ),
        writeFile(
          path.join(packageRoot, 'index.js'),
          [
            "const fs = require('fs');",
            "const path = require('path');",
            "module.exports = { marker: 'vendor-builtins', readType: typeof fs.readFileSync, joinType: typeof path.join };",
          ].join('\n'),
          'utf8',
        ),
      ]);
      await symlink(
        path.relative(path.dirname(packageLink), packageRoot),
        packageLink,
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const result = await new PreviewVendorModuleBuilder().prepare({
        bundle: createApplicationBundle(applicationSource),
        globalPackagePlan: EMPTY_GLOBAL_PACKAGE_PLAN,
        metafile: createApplicationMetafile(packageName, applicationSource),
        nodePaths: [],
        projectRoot,
        workspaceRoot,
      });
      const javascript = decodeJavaScriptChunks(result);

      expect(result.moduleImports?.map(({ specifier }) => specifier)).toEqual([packageName]);
      expect(javascript).toContain('vendor-builtins');
      expect(javascript).toContain('previewNodeBuiltinNeutralValue');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Resolves an external package from the workspace module that actually imported it. */
  it('uses the authored importer directory for workspace-package vendor demands', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-vendor-owner-'));
    const projectRoot = path.join(workspaceRoot, 'apps', 'web');
    const ownerRoot = path.join(workspaceRoot, 'packages', 'owner');
    const ownerSourcePath = path.join(ownerRoot, 'src', 'index.ts');
    const packageName = 'preview-owner-dependency';
    const packageRoot = path.join(ownerRoot, 'node_modules', packageName);
    const applicationSource = `import { marker } from ${JSON.stringify(packageName)}; globalThis.__previewMarker = marker;`;
    try {
      await Promise.all([
        mkdir(projectRoot, { recursive: true }),
        mkdir(path.dirname(ownerSourcePath), { recursive: true }),
        mkdir(packageRoot, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(projectRoot, 'package.json'),
          `${JSON.stringify({ name: 'web', private: true })}\n`,
          'utf8',
        ),
        writeFile(ownerSourcePath, applicationSource, 'utf8'),
        writeFile(
          path.join(packageRoot, 'package.json'),
          `${JSON.stringify({ exports: './index.js', name: packageName, type: 'module' })}\n`,
          'utf8',
        ),
        writeFile(
          path.join(packageRoot, 'index.js'),
          "export const marker = 'workspace-owner-marker';\n",
          'utf8',
        ),
      ]);

      const result = await new PreviewVendorModuleBuilder().prepare({
        bundle: createApplicationBundle(applicationSource),
        globalPackagePlan: EMPTY_GLOBAL_PACKAGE_PLAN,
        metafile: createApplicationMetafile(
          packageName,
          applicationSource,
          path.relative(workspaceRoot, ownerSourcePath),
        ),
        nodePaths: [],
        projectRoot,
        workspaceRoot,
      });

      expect(decodeJavaScriptChunks(result)).toContain('workspace-owner-marker');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

/** Creates the same package identity with project-local bytes under one workspace application. */
async function writeProjectPackage(projectRoot: string, marker: string): Promise<void> {
  const packageRoot = path.join(projectRoot, 'node_modules', PACKAGE_NAME);
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(projectRoot, 'package.json'),
      `${JSON.stringify({ name: path.basename(projectRoot), private: true })}\n`,
      'utf8',
    ),
    writeFile(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({ exports: './index.js', name: PACKAGE_NAME, type: 'module' })}\n`,
      'utf8',
    ),
    writeFile(
      path.join(packageRoot, 'index.js'),
      `export const marker = ${JSON.stringify(marker)};\n`,
      'utf8',
    ),
  ]);
}

/** Creates the application chunk that asks the vendor builder for the fixture package. */
function createApplicationBundle(source = APPLICATION_SOURCE): PreviewBundle {
  return {
    chunks: [],
    dependencies: [],
    diagnostics: [],
    javascript: new TextEncoder().encode(source),
    watchDirectories: [],
  };
}

/** Describes the fixture package as the application's only external browser edge. */
function createApplicationMetafile(
  packageName = PACKAGE_NAME,
  source = APPLICATION_SOURCE,
  importer?: string,
): Metafile {
  const externalImport = { external: true, kind: 'import-statement' as const, path: packageName };
  return {
    inputs:
      importer === undefined
        ? {}
        : {
            [importer]: {
              bytes: source.length,
              imports: [externalImport],
            },
          },
    outputs: {
      'entry.js': {
        bytes: source.length,
        exports: [],
        imports: [externalImport],
        inputs: {},
      },
    },
  };
}

/** Joins generated vendor chunks so package-version assertions remain filename-independent. */
function decodeJavaScriptChunks(bundle: PreviewBundle): string {
  return bundle.chunks
    .filter(({ relativePath }) => relativePath.endsWith('.js'))
    .map(({ contents }) => new TextDecoder().decode(contents))
    .join('\n');
}
