/** Verifies missing code-generated contracts degrade to bounded render-only values. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build, type Plugin } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import {
  createPreviewGeneratedModuleFallbackPlugin,
  preparePreviewGeneratedBarrelFallback,
} from '../../../src/adapters/esbuild/previewGeneratedModuleFallback';
import { PreviewSourceTransformer } from '../../../src/adapters/esbuild/staticResources/previewSourceTransformer';
import { createWorkspaceSourcePlugin } from '../../../src/adapters/esbuild/workspaceSourcePlugin';

describe('generated module preview fallback', () => {
  /** Converts a generated-only barrel to CommonJS so arbitrary downstream named DTO imports survive. */
  it('loads a missing generated PnP package through recursive neutral contract values', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-generated-barrel-'));
    const physicalPath = path.join(workspaceRoot, 'shared', 'proto', 'index.ts');
    const virtualPath = path.join(
      workspaceRoot,
      '.yarn',
      '__virtual__',
      '@scope-proto-virtual-1234567890',
      '1',
      'shared',
      'proto',
      'index.ts',
    );
    try {
      await mkdir(path.dirname(physicalPath), { recursive: true });
      await mkdir(path.join(path.dirname(physicalPath), 'proto'), { recursive: true });
      await writeFile(physicalPath, "export * from './generated';", 'utf8');
      await writeFile(
        path.join(path.dirname(physicalPath), 'proto', 'timestamp.proto'),
        'message Timestamp {}',
        'utf8',
      );
      const result = await buildPreviewFixture({
        entrySource: [
          "import { Timestamp } from '@scope/proto';",
          'let propertyCursor = Timestamp;',
          'let callCursor = Timestamp;',
          'for (let index = 0; index < 20; index += 1) {',
          '  propertyCursor = propertyCursor?.parent;',
          '  callCursor = callCursor?.();',
          '}',
          "console.log(Timestamp.fromJSON({}).seconds, propertyCursor, callCursor, 'unknown' in Timestamp);",
        ].join('\n'),
        plugins: [
          createVirtualResolutionPlugin('@scope/proto', virtualPath),
          createWorkspacePlugin(workspaceRoot),
        ],
        workspaceRoot,
      });

      expect(result.outputFiles?.[0]?.text).toContain('ReactPreviewGeneratedContractNeutral');
      expect(result.warnings[0]?.text).toContain('Generated project source');
      const consoleFixture = { log: vi.fn(), warn: vi.fn() };
      expect(() => {
        vm.runInNewContext(result.outputFiles?.[0]?.text ?? '', { console: consoleFixture });
      }).not.toThrow();
      expect(consoleFixture.log).toHaveBeenCalledOnce();
      expect(consoleFixture.log.mock.calls[0]?.slice(1)).toEqual([undefined, undefined, false]);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Handles direct generated imports but leaves an ordinary missing React component unresolved. */
  it('limits direct fallback to explicit generated-source conventions', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-generated-direct-'));
    const importerPath = path.join(workspaceRoot, 'src', 'entry.ts');
    try {
      await mkdir(path.dirname(importerPath), { recursive: true });
      const fallbackPlugin = createPreviewGeneratedModuleFallbackPlugin({ workspaceRoot });

      await writeFile(
        importerPath,
        "import { Contract } from './generated'; console.log(Contract.create({}));",
        'utf8',
      );
      const generated = await buildFileFixture(importerPath, [fallbackPlugin], workspaceRoot);
      expect(generated.outputFiles?.[0]?.text).toContain('ReactPreviewGeneratedContractNeutral');

      await writeFile(
        importerPath,
        "import MissingCard from './MissingCard'; console.log(MissingCard);",
        'utf8',
      );
      await expect(buildFileFixture(importerPath, [fallbackPlugin], workspaceRoot)).rejects.toThrow(
        'Could not resolve "./MissingCard"',
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Never replaces a mixed authored barrel or a generated module that already exists. */
  it('preserves authored and existing generated source', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-generated-existing-'));
    const barrelPath = path.join(workspaceRoot, 'src', 'index.ts');
    try {
      await mkdir(path.join(workspaceRoot, 'src', 'generated'), { recursive: true });
      await writeFile(
        path.join(workspaceRoot, 'src', 'generated', 'index.ts'),
        'export const Contract = 1;',
        'utf8',
      );

      expect(
        preparePreviewGeneratedBarrelFallback(
          barrelPath,
          "export * from './generated';",
          workspaceRoot,
        ),
      ).toBeUndefined();
      expect(
        preparePreviewGeneratedBarrelFallback(
          barrelPath,
          "export * from './missing-generated'; export const authored = true;",
          workspaceRoot,
        ),
      ).toBeUndefined();
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

/** Small esbuild fixture that keeps all generated output in memory. */
async function buildPreviewFixture(options: {
  readonly entrySource: string;
  readonly plugins: readonly Plugin[];
  readonly workspaceRoot: string;
}): Promise<Awaited<ReturnType<typeof build>>> {
  return await build({
    absWorkingDir: options.workspaceRoot,
    bundle: true,
    format: 'cjs',
    logLevel: 'silent',
    plugins: [...options.plugins],
    stdin: {
      contents: options.entrySource,
      loader: 'ts',
      resolveDir: options.workspaceRoot,
    },
    write: false,
  });
}

/** File-backed build used when resolver ownership depends on an absolute importer identity. */
async function buildFileFixture(
  entryPath: string,
  plugins: readonly Plugin[],
  workspaceRoot: string,
): Promise<Awaited<ReturnType<typeof build>>> {
  return await build({
    absWorkingDir: workspaceRoot,
    bundle: true,
    entryPoints: [entryPath],
    format: 'esm',
    logLevel: 'silent',
    plugins: [...plugins],
    write: false,
  });
}

/** Workspace loader configured with the same transform boundary used by the compiler. */
function createWorkspacePlugin(workspaceRoot: string): Plugin {
  return createWorkspaceSourcePlugin({
    snapshots: [],
    transformer: new PreviewSourceTransformer({ projectRoot: workspaceRoot, workspaceRoot }),
    workspaceRoot,
  });
}

/** Reproduces an esbuild/Yarn resolution that identifies a workspace through a missing virtual path. */
function createVirtualResolutionPlugin(moduleSpecifier: string, virtualPath: string): Plugin {
  return {
    name: 'test-generated-virtual-resolution',
    setup(buildContext): void {
      buildContext.onResolve({ filter: /^@scope\/proto$/ }, (arguments_) =>
        arguments_.path === moduleSpecifier ? { path: virtualPath } : undefined,
      );
    },
  };
}
