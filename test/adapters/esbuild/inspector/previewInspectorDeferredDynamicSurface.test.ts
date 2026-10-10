/**
 * Verifies that an omitted off-corridor dynamic import keeps the named exports authored code reads
 * from the import promise, so `import('./Picker').then((mod) => mod.Picker)` is never `undefined`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPreviewInspectorCorridorPlugin,
  type PreviewInspectorAncestorPlan,
} from '../../../../src/adapters/esbuild/inspector';
import { createPreviewDeferredDynamicSurfaceSource } from '../../../../src/adapters/esbuild/inspector/previewInspectorDeferredDynamicSurface';
import { createPreviewStaticModuleResolver } from '../../../../src/adapters/esbuild/previewStaticModuleResolver';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('deferred dynamic import surface', () => {
  /** Every explicit runtime export name becomes the inert component; wildcards are skipped. */
  it('mirrors the target module explicit export names', async () => {
    const workspaceRoot = await createWorkspace();
    const targetPath = path.join(workspaceRoot, 'Picker.tsx');
    await writeFile(
      targetPath,
      [
        "export * from './other';",
        'export const Picker = () => null;',
        'export function usePicker() { return 1; }',
        'export default function Fallback() { return null; }',
      ].join('\n'),
    );

    const source = await createPreviewDeferredDynamicSurfaceSource(targetPath);

    expect(source).toContain('export default ReactPreviewDeferredCorridorRoute;');
    expect(source).toContain('export const Picker = ReactPreviewDeferredCorridorRoute;');
    expect(source).toContain('export const usePicker = ReactPreviewDeferredCorridorRoute;');
    expect(source).not.toContain('export const Fallback');
  });

  /** The page module that picks a named component from an omitted import still evaluates. */
  it('resolves a named export read from an omitted corridor dynamic import', async () => {
    const workspaceRoot = await createWorkspace();
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entryPath = path.join(sourceRoot, 'entry.ts');
    const selectedPath = path.join(sourceRoot, 'Selected.ts');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(
        entryPath,
        [
          "export { default as Selected } from './Selected';",
          "export const loadPicker = () => import('./Picker').then((mod) => mod.Picker);",
        ].join('\n'),
      ),
      writeFile(selectedPath, "export default 'SELECTED_MARKER';"),
      writeFile(path.join(sourceRoot, 'Picker.ts'), "export const Picker = () => 'PICKER_MARKER';"),
    ]);

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'cjs',
      plugins: [
        createPreviewInspectorCorridorPlugin({
          plan: createCorridorPlan(entryPath, selectedPath),
          projectRoot: workspaceRoot,
          resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
          workspaceRoot,
        }),
      ],
      write: false,
    });
    const javascript = result.outputFiles[0]?.text ?? '';
    const module = { exports: {} as { loadPicker?: () => Promise<unknown> } };
    runInNewContext(javascript, { module, exports: module.exports, Promise });
    const picker = await module.exports.loadPicker?.();

    expect(javascript).not.toContain('PICKER_MARKER');
    expect(typeof picker).toBe('function');
    expect((picker as () => unknown)()).toBeNull();
  });
});

/** Creates a removable workspace. */
async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'react-preview-deferred-dynamic-'));
  temporaryDirectories.push(directory);
  return directory;
}

/** Builds the smallest corridor plan whose render path is entry → selected. */
function createCorridorPlan(entryPath: string, selectedPath: string): PreviewInspectorAncestorPlan {
  const target = { exportName: 'default', sourcePath: selectedPath };
  const renderPath = {
    entryPoint: {
      kind: 'create-root' as const,
      occurrenceStart: 0,
      sourcePath: entryPath,
      wrapperNames: [],
    },
    id: 'candidate-selected-path',
    steps: [
      {
        certainty: 'confirmed' as const,
        evidenceSourcePaths: [],
        kind: 'react-lazy' as const,
        label: 'Selected',
        occurrenceStart: 0,
        sourcePath: selectedPath,
        wrapperNames: [],
      },
      {
        certainty: 'confirmed' as const,
        kind: 'entry-render' as const,
        label: 'entry',
        occurrenceStart: 0,
        sourcePath: entryPath,
        wrapperNames: [],
      },
    ],
  };
  const renderChain = {
    dependencyPaths: [entryPath, selectedPath],
    paths: [renderPath],
    reachability: 'entry-connected' as const,
    target,
    truncated: false,
  };
  const pageCandidate = {
    complete: true,
    dependencyPaths: [entryPath, selectedPath],
    edges: [],
    id: 'candidate-selected',
    renderPath,
    root: target,
    rootAutomaticProps: {},
    rootOwnsRouter: false,
    stopReason: 'root-reached' as const,
    targetAutomaticProps: {},
  };
  return {
    ...pageCandidate,
    pageCandidates: [pageCandidate],
    renderChain,
    renderChainsByExport: { default: renderChain },
    target,
  };
}
