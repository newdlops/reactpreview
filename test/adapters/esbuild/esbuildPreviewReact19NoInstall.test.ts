/**
 * Verifies the render-only React 19 compatibility seed used by freshly cloned lockless projects.
 * The fixture deliberately requests an older exact minor than the extension ships and never gains
 * a project node_modules directory, matching the Next sandbox failure captured in log.txt.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('EsbuildPreviewCompiler with a lockless exact React 19 manifest', () => {
  /** Uses the newer paired same-major seed and leaves the authored project entirely unchanged. */
  it('renders exact React 19.1 source with the extension React 19.2 runtime', async () => {
    const fixtureRoot = await mkdtemp(
      path.join(process.cwd(), '.tmp', 'react-preview-react19-exact-'),
    );
    temporaryRoots.push(fixtureRoot);
    const projectRoot = path.join(fixtureRoot, 'project');
    const sourceRoot = path.join(projectRoot, 'src');
    const targetPath = path.join(sourceRoot, 'App.tsx');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({
          dependencies: { react: '19.1.0', 'react-dom': '19.1.0' },
          name: 'lockless-react-19-app',
          private: true,
          version: '1.0.0',
        }),
        'utf8',
      ),
      writeFile(
        targetPath,
        [
          "import { version as reactVersion } from 'react';",
          "import { version as reactDomVersion } from 'react-dom';",
          'export default function App() {',
          '  return (',
          '    <main data-react-runtime={`${reactVersion}:${reactDomVersion}`}>',
          '      LOCKLESS_EXACT_REACT_19_PREVIEW',
          '    </main>',
          '  );',
          '}',
          '',
        ].join('\n'),
        'utf8',
      ),
    ]);
    const compiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: path.join(process.cwd(), 'node_modules'),
      managedDependencyStoreRoot: path.join(fixtureRoot, 'preview-store'),
    });

    try {
      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        preparationMode: 'fast',
        sourceText: await readFile(targetPath, 'utf8'),
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });

      const javascript = new TextDecoder().decode(bundle.javascript);
      expect(javascript).toContain('LOCKLESS_EXACT_REACT_19_PREVIEW');
      expect(javascript).toContain('19.2.7');
      await expect(readFile(path.join(projectRoot, 'node_modules'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await compiler.shutdown();
    }
  });
});
