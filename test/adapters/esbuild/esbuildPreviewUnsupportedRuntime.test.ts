/**
 * Verifies that framework-owned source stops before React graph discovery or package acquisition.
 * The fixture mirrors the node_modules-free Solid sandbox captured in log.txt and deliberately
 * provides only inert manifest and tsconfig evidence, never a Solid compiler implementation.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { PreviewCompilationError } from '../../../src/domain/preview';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('EsbuildPreviewCompiler unsupported target runtime preflight', () => {
  /** Returns a precise Solid diagnostic before the expensive React-only preparation pipeline. */
  it('rejects a lockless Solid target without trying to install or scan it as React', async () => {
    const fixtureRoot = await mkdtemp(path.join(process.cwd(), '.tmp', 'react-preview-solid-'));
    temporaryRoots.push(fixtureRoot);
    const projectRoot = path.join(fixtureRoot, 'project');
    const sourceRoot = path.join(projectRoot, 'src');
    const targetPath = path.join(sourceRoot, 'Page.tsx');
    const sourceText = [
      "import { createSignal } from 'solid-js';",
      'export const Page = () => {',
      '  const [name] = createSignal("Solid");',
      '  return <main>{name()}</main>;',
      '};',
    ].join('\n');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ dependencies: { 'solid-js': '^1.9.5' }, name: 'solid-fixture' }),
        'utf8',
      ),
      writeFile(
        path.join(projectRoot, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { jsx: 'preserve', jsxImportSource: 'solid-js' } }),
        'utf8',
      ),
      writeFile(targetPath, sourceText, 'utf8'),
    ]);
    const progressStages: string[] = [];
    let acquisitionCount = 0;
    let failure: unknown;
    const compiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: path.join(process.cwd(), 'node_modules'),
      lockedDependencyAcquirer: () => {
        acquisitionCount += 1;
        return Promise.resolve(undefined);
      },
      managedDependencyStoreRoot: path.join(fixtureRoot, 'preview-store'),
    });

    try {
      await compiler.compile(
        {
          dependencySnapshots: [],
          documentPath: targetPath,
          language: 'tsx',
          renderMode: 'page-inspector',
          sourceText,
          useStorybookPreview: false,
          workspaceRoot: projectRoot,
        },
        { reportProgress: (stage) => progressStages.push(stage) },
      );
    } catch (error) {
      failure = error;
    } finally {
      await compiler.shutdown();
    }

    expect(failure).toBeInstanceOf(PreviewCompilationError);
    if (failure instanceof PreviewCompilationError) {
      expect(failure.message).toContain('SolidJS target');
      expect(failure.diagnostics[0]?.location).toMatchObject({ file: targetPath, line: 1 });
      expect(failure.diagnostics[0]?.notes?.join('\n')).toContain('vite-plugin-solid');
    }
    expect(acquisitionCount).toBe(0);
    expect(progressStages).not.toContain('discovering-components');
    await expect(readFile(path.join(projectRoot, 'node_modules'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
