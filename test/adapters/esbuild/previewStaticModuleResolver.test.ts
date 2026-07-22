/** Verifies static alias resolution without evaluating project configuration or source modules. */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';

describe('createPreviewStaticModuleResolver', () => {
  /** Resolves a sibling monorepo package through the importing application's nearest tsconfig. */
  it('matches a non-suffix tsconfig alias to its exact target source', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-static-resolver-'));
    const appRoot = path.join(workspaceRoot, 'packages', 'app');
    const appSource = path.join(appRoot, 'src');
    const uiSource = path.join(workspaceRoot, 'packages', 'ui', 'src');
    const consumerPath = path.join(appSource, 'Page.tsx');
    const targetPath = path.join(uiSource, 'Target.tsx');
    try {
      await Promise.all([
        mkdir(appSource, { recursive: true }),
        mkdir(uiSource, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(appRoot, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              baseUrl: '.',
              jsx: 'react-jsx',
              paths: {
                '@design/*': ['../ui/src/*'],
                '@escape/*': ['../../../outside/*'],
                '@selected': ['../ui/src/Target.tsx'],
              },
            },
          }),
          'utf8',
        ),
        writeFile(consumerPath, "import { Target } from '@design/Target';", 'utf8'),
        writeFile(targetPath, 'export function Target() { return <button />; }', 'utf8'),
      ]);

      const resolver = createPreviewStaticModuleResolver({ workspaceRoot });

      expect(resolver.resolve('@design/Target', consumerPath)).toBe(await realpath(targetPath));
      expect(resolver.matchesTarget('@design/Target', consumerPath, targetPath)).toBe(true);
      expect(resolver.matchesTarget('@selected', consumerPath, targetPath)).toBe(true);
      expect(resolver.getMatchedSpecifiers(targetPath)).toEqual(['@design/Target', '@selected']);
      expect(resolver.matchesTarget('@design/Missing', consumerPath, targetPath)).toBe(false);
      expect(resolver.resolveMissingPathAliasCandidate('@design/Missing', consumerPath)).toBe(
        path.join(await realpath(uiSource), 'Missing'),
      );
      expect(resolver.resolveMissingPathAliasCandidate('./Missing', consumerPath)).toBeUndefined();
      expect(
        resolver.resolveMissingPathAliasCandidate('@escape/Missing', consumerPath),
      ).toBeUndefined();
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Refuses an explicit config outside the workspace and still resolves ordinary relative files. */
  it('keeps configured resolution inside the trusted workspace', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-static-boundary-'));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-static-outside-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const consumerPath = path.join(sourceRoot, 'Page.tsx');
    const targetPath = path.join(sourceRoot, 'Target.tsx');
    try {
      await mkdir(sourceRoot, { recursive: true });
      await Promise.all([
        writeFile(path.join(outsideRoot, 'tsconfig.json'), '{}', 'utf8'),
        writeFile(consumerPath, "import { Target } from './Target';", 'utf8'),
        writeFile(targetPath, 'export const Target = () => null;', 'utf8'),
      ]);

      const resolver = createPreviewStaticModuleResolver({
        configuredTsconfigPath: path.join(outsideRoot, 'tsconfig.json'),
        workspaceRoot,
      });

      expect(resolver.matchesTarget('./Target', consumerPath, targetPath)).toBe(true);
    } finally {
      await Promise.all([
        rm(workspaceRoot, { force: true, recursive: true }),
        rm(outsideRoot, { force: true, recursive: true }),
      ]);
    }
  });

  /** Reads nearest JSX ownership without executing project config or crossing package boundaries. */
  it('distinguishes React defaults from Preact and custom classic factories', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-static-jsx-runtime-'));
    const reactRoot = path.join(workspaceRoot, 'packages', 'react-app');
    const preactRoot = path.join(workspaceRoot, 'packages', 'preact-app');
    const customRoot = path.join(workspaceRoot, 'packages', 'custom-app');
    const reactConsumer = path.join(reactRoot, 'src', 'Page.tsx');
    const preactConsumer = path.join(preactRoot, 'src', 'Page.tsx');
    const customConsumer = path.join(customRoot, 'src', 'Page.tsx');
    try {
      await Promise.all(
        [reactConsumer, preactConsumer, customConsumer].map((consumerPath) =>
          mkdir(path.dirname(consumerPath), { recursive: true }),
        ),
      );
      await Promise.all([
        writeFile(
          path.join(reactRoot, 'tsconfig.json'),
          JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }),
          'utf8',
        ),
        writeFile(
          path.join(preactRoot, 'tsconfig.json'),
          JSON.stringify({ compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'preact' } }),
          'utf8',
        ),
        writeFile(
          path.join(customRoot, 'tsconfig.json'),
          JSON.stringify({ compilerOptions: { jsx: 'react', jsxFactory: 'h' } }),
          'utf8',
        ),
      ]);
      const resolver = createPreviewStaticModuleResolver({ workspaceRoot });

      expect(resolver.usesAlternativeJsxRuntime(reactConsumer)).toBe(false);
      expect(resolver.usesAlternativeJsxRuntime(preactConsumer)).toBe(true);
      expect(resolver.usesAlternativeJsxRuntime(customConsumer)).toBe(true);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Uses immutable managed packages only after normal project resolution has no installed match. */
  it('supports a local-first managed node_modules fallback', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-static-managed-'));
    const managedRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-static-store-'));
    const consumerPath = path.join(workspaceRoot, 'src', 'Page.tsx');
    const managedPackageRoot = path.join(managedRoot, 'node_modules', 'runtime-package');
    const localPackageRoot = path.join(workspaceRoot, 'node_modules', 'runtime-package');
    try {
      await Promise.all([
        mkdir(path.dirname(consumerPath), { recursive: true }),
        mkdir(managedPackageRoot, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(consumerPath, "import value from 'runtime-package';", 'utf8'),
        writeFile(
          path.join(managedPackageRoot, 'package.json'),
          JSON.stringify({ main: 'index.js', name: 'runtime-package', version: '1.0.0' }),
          'utf8',
        ),
        writeFile(path.join(managedPackageRoot, 'index.js'), 'export default "managed";', 'utf8'),
      ]);

      const managedResolver = createPreviewStaticModuleResolver({
        fallbackNodeModulesPaths: [path.join(managedRoot, 'node_modules')],
        workspaceRoot,
      });
      expect(managedResolver.resolve('runtime-package', consumerPath)).toBe(
        await realpath(path.join(managedPackageRoot, 'index.js')),
      );

      await mkdir(localPackageRoot, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(localPackageRoot, 'package.json'),
          JSON.stringify({ main: 'index.js', name: 'runtime-package', version: '2.0.0' }),
          'utf8',
        ),
        writeFile(path.join(localPackageRoot, 'index.js'), 'export default "local";', 'utf8'),
      ]);
      const localResolver = createPreviewStaticModuleResolver({
        fallbackNodeModulesPaths: [path.join(managedRoot, 'node_modules')],
        workspaceRoot,
      });
      expect(localResolver.resolve('runtime-package', consumerPath)).toBe(
        await realpath(path.join(localPackageRoot, 'index.js')),
      );
    } finally {
      await Promise.all([
        rm(workspaceRoot, { force: true, recursive: true }),
        rm(managedRoot, { force: true, recursive: true }),
      ]);
    }
  });
});
