/** Exercises final router revalidation after a provisional frontier overestimates provider ownership. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import type { PreviewBuildRequest } from '../../../src/domain/preview';

// A projected-away provider is valid provisional evidence, but not part of the emitted graph.
vi.mock('../../../src/adapters/esbuild/previewAdaptiveBuildSeed', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/adapters/esbuild/previewAdaptiveBuildSeed')>();
  return {
    ...actual,
    preparePreviewAdaptiveBuildSeed: async (
      ...args: Parameters<typeof actual.preparePreviewAdaptiveBuildSeed>
    ) => ({
      ...(await actual.preparePreviewAdaptiveBuildSeed(...args)),
      routerRequirement: { consumesRouter: true, ownsRouter: true },
    }),
  };
});

describe('adaptive router evidence reuse', () => {
  it('keeps Inspector ownership changes in one pass while revalidating router activation', async () => {
    const root = await mkdtemp(path.resolve('test/fixtures/router-inspector-reuse-'));
    const documentPath = path.join(root, 'Preview.tsx');
    const childPath = path.join(root, 'Child.tsx');
    const packageRoot = path.join(root, 'node_modules/react-router-dom');
    const sourceText =
      "import Child from './Child'; export default function Preview() { return <Child />; }";
    const childSource =
      "import { useLocation } from 'react-router-dom'; export default function Child() { return <p>{useLocation().pathname}</p>; }";
    const compiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(packageRoot, { recursive: true });
      await Promise.all([
        writeFile(documentPath, sourceText),
        writeFile(childPath, childSource),
        writeFile(
          path.join(packageRoot, 'package.json'),
          JSON.stringify({ name: 'react-router-dom', exports: './index.js', type: 'module' }),
        ),
        writeFile(
          path.join(packageRoot, 'index.js'),
          `
          export function BrowserRouter({children}) { return children; }
          export function MemoryRouter({children}) { return children; }
          export function useLocation() { return {pathname:'/'}; }
        `,
        ),
      ]);
      /** Counts completed native builds without replacing discovery, graph checks, or compilation. */
      const compile = async (
        childText: string,
        renderMode: 'component' | 'page-inspector' = 'page-inspector',
      ): Promise<{ readonly passes: number; readonly automatic: boolean }> => {
        let passes = 0;
        const bundle = await compiler.compile(
          {
            dependencySnapshots: [
              { documentPath: childPath, language: 'tsx', sourceText: childText },
            ],
            documentPath,
            language: 'tsx',
            preparationMode: 'fast',
            renderMode,
            sourceText,
            useStorybookPreview: false,
            workspaceRoot: root,
          },
          {
            reportProgress: (_stage, activity) => {
              if (activity?.kind === 'native-build' && activity.phase === 'processing-output')
                passes += 1;
            },
          },
        );
        expect(bundle.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
        return {
          automatic: /AUTOMATIC_ROUTER_BOUNDARY_ENABLED\s*=\s*true/u.test(
            new TextDecoder().decode(bundle.javascript),
          ),
          passes,
        };
      };
      expect(await compile(childSource)).toEqual({ automatic: true, passes: 1 });
      expect(await compile(childSource)).toEqual({ automatic: true, passes: 1 });
      const providerSource =
        "import { BrowserRouter, useLocation } from 'react-router-dom'; export default function Child() { return <BrowserRouter><p>{useLocation().pathname}</p></BrowserRouter>; }";
      expect(await compile(providerSource)).toEqual({ automatic: true, passes: 1 });
      expect(await compile(childSource)).toEqual({ automatic: true, passes: 1 });
      const plainSource = 'export default function Child() { return <p>Plain</p>; }';
      expect(await compile(plainSource)).toEqual({ automatic: false, passes: 2 });
      expect(await compile(plainSource)).toEqual({ automatic: false, passes: 1 });
      expect(await compile(childSource)).toEqual({ automatic: true, passes: 2 });
      expect(await compile(providerSource, 'component')).toEqual({ automatic: false, passes: 1 });
      expect(await compile(childSource)).toEqual({ automatic: true, passes: 1 });
      expect(await compile(childSource, 'component')).toEqual({ automatic: true, passes: 2 });
      expect(await compile(providerSource)).toEqual({ automatic: true, passes: 1 });
      expect(await compile(providerSource, 'component')).toEqual({ automatic: false, passes: 2 });
    } finally {
      await compiler.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('removes repeat corrective passes, while revalidating edited dependencies before publication', async () => {
    const root = await mkdtemp(path.resolve('test/fixtures/router-reuse-'));
    const documentPath = path.join(root, 'Preview.tsx');
    const childPath = path.join(root, 'Child.tsx');
    const packageRoot = path.join(root, 'node_modules/react-router-dom');
    const sourceText =
      "import Child from './Child'; export default function Preview() { return <Child />; }";
    const childSource =
      "import { useLocation } from 'react-router-dom'; export default function Child() { return <p>{useLocation().pathname}</p>; }";
    const compiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(packageRoot, { recursive: true });
      await Promise.all([
        writeFile(documentPath, sourceText),
        writeFile(childPath, childSource),
        writeFile(
          path.join(packageRoot, 'package.json'),
          JSON.stringify({ name: 'react-router-dom', exports: './index.js', type: 'module' }),
        ),
        writeFile(
          path.join(packageRoot, 'index.js'),
          `
          export function BrowserRouter({children}) { return children; }
          export function MemoryRouter({children}) { return children; }
          export function useLocation() { return {pathname:'/'}; }
        `,
        ),
      ]);
      /** Captures actual native passes and final router configuration from the emitted bytes. */
      const compile = async (
        childText: string,
      ): Promise<{ readonly passes: number; readonly automatic: boolean }> => {
        const request: PreviewBuildRequest = {
          dependencySnapshots: [
            { documentPath: childPath, language: 'tsx', sourceText: childText },
          ],
          documentPath,
          language: 'tsx',
          preparationMode: 'fast',
          sourceText,
          useStorybookPreview: false,
          workspaceRoot: root,
        };
        let passes = 0;
        const bundle = await compiler.compile(request, {
          reportProgress: (_stage, activity) => {
            if (activity?.kind === 'native-build' && activity.phase === 'processing-output')
              passes += 1;
          },
        });
        const javascript = new TextDecoder().decode(bundle.javascript);
        expect(bundle.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
        return {
          automatic: /AUTOMATIC_ROUTER_BOUNDARY_ENABLED\s*=\s*true/u.test(javascript),
          passes,
        };
      };
      expect(await compile(childSource)).toEqual({ automatic: true, passes: 2 });
      expect(await compile(childSource)).toEqual({ automatic: true, passes: 1 });
      const providerSource =
        "import { BrowserRouter, useLocation } from 'react-router-dom'; export default function Child() { return <BrowserRouter><p>{useLocation().pathname}</p></BrowserRouter>; }";
      expect(await compile(providerSource)).toEqual({ automatic: false, passes: 2 });
      expect(await compile(providerSource)).toEqual({ automatic: false, passes: 1 });
      expect(await compile(childSource)).toEqual({ automatic: true, passes: 2 });
    } finally {
      await compiler.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
