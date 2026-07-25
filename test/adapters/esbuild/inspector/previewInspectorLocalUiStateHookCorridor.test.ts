/**
 * Verifies that a selected Page Inspector corridor retains only proven local UI controllers.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorCorridorPlugin,
  type PreviewInspectorAncestorPlan,
} from '../../../../src/adapters/esbuild/inspector';
import { createPreviewStaticModuleResolver } from '../../../../src/adapters/esbuild/previewStaticModuleResolver';

describe('local UI state in a Page Inspector corridor', () => {
  /**
   * Preserves a modal controller's shared state/action closure while still cutting an ordinary
   * project data hook imported by the same exact selected module.
   */
  it('keeps React-local visibility actions authentic and projects backend-shaped hooks', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-ui-state-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entryPath = path.join(sourceRoot, 'entry.ts');
    const selectedPath = path.join(sourceRoot, 'Selected.ts');
    const controllerPath = path.join(sourceRoot, 'useOverlayActions.ts');
    const sessionPath = path.join(sourceRoot, 'useSession.ts');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(entryPath, `export { default } from './Selected';`),
      writeFile(
        selectedPath,
        [
          `import { useOverlayActions } from './useOverlayActions';`,
          `import { useSession } from './useSession';`,
          `export default function Selected() {`,
          `  const [overlay, actions] = useOverlayActions();`,
          `  const { user } = useSession();`,
          `  return { overlay, actions, user };`,
          `}`,
        ].join('\n'),
      ),
      writeFile(
        controllerPath,
        [
          `import { useCallback, useState } from 'react';`,
          `export const useOverlayActions = () => {`,
          `  const [showState, setShowState] = useState(false);`,
          `  const show = useCallback(() => setShowState(true), [setShowState]);`,
          `  const hide = useCallback(() => setShowState(false), [setShowState]);`,
          `  return [`,
          `    { show: showState, marker: 'AUTHENTIC_UI_CONTROLLER_MARKER' },`,
          `    { show, hide },`,
          `  ];`,
          `};`,
        ].join('\n'),
      ),
      writeFile(
        sessionPath,
        [
          `export const useSession = () => ({`,
          `  user: 'PROJECT_SESSION_IMPLEMENTATION_MARKER',`,
          `});`,
        ].join('\n'),
      ),
    ]);
    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      external: ['react'],
      format: 'esm',
      outfile: path.join(workspaceRoot, 'out.js'),
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
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

    expect(source).toContain('AUTHENTIC_UI_CONTROLLER_MARKER');
    expect(source).not.toContain('PROJECT_SESSION_IMPLEMENTATION_MARKER');
  });

  /**
   * Retains a custom hook's map/filter/view-model logic, then recursively projects the direct data
   * source hook one level below it instead of pulling that implementation into the page bundle.
   */
  it('keeps authored hook computation while cutting its external data leaf', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-hook-logic-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entryPath = path.join(sourceRoot, 'entry.ts');
    const selectedPath = path.join(sourceRoot, 'Selected.ts');
    const hookBarrelPath = path.join(sourceRoot, 'hooks.ts');
    const derivedHookPath = path.join(sourceRoot, 'useVisibleRows.ts');
    const backendHookPath = path.join(sourceRoot, 'useBackendRows.ts');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(entryPath, `export { default } from './Selected';`),
      writeFile(
        selectedPath,
        [
          `import { useVisibleRows } from './hooks';`,
          `export default function Selected() {`,
          `  const { labels } = useVisibleRows();`,
          `  return { labels };`,
          `}`,
        ].join('\n'),
      ),
      writeFile(hookBarrelPath, `export { useVisibleRows } from './useVisibleRows';`),
      writeFile(
        derivedHookPath,
        [
          `import { useBackendRows } from './useBackendRows';`,
          `export const useVisibleRows = () => {`,
          `  const { rows } = useBackendRows();`,
          `  return {`,
          `    labels: rows`,
          `      .filter((row) => row.visible)`,
          `      .map((row) => row.name + ':AUTHORED_DERIVATION_MARKER'),`,
          `  };`,
          `};`,
        ].join('\n'),
      ),
      writeFile(
        backendHookPath,
        [
          `import { useRemoteRows } from 'data-client';`,
          `const marker = 'BACKEND_IMPLEMENTATION_MARKER';`,
          `export const useBackendRows = () => useRemoteRows(marker);`,
        ].join('\n'),
      ),
    ]);
    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      external: ['data-client'],
      format: 'esm',
      outfile: path.join(workspaceRoot, 'out.js'),
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
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

    expect(source).toContain('AUTHORED_DERIVATION_MARKER');
    expect(source).not.toContain('BACKEND_IMPLEMENTATION_MARKER');
  });
});

/** Creates the minimum immutable plan whose exact selected module imports the tested hooks. */
function createCorridorPlan(entryPath: string, selectedPath: string): PreviewInspectorAncestorPlan {
  const target = { exportName: 'default', sourcePath: selectedPath };
  const renderPath = {
    entryPoint: {
      kind: 'create-root' as const,
      occurrenceStart: 0,
      sourcePath: entryPath,
      wrapperNames: [],
    },
    id: 'selected-path',
    steps: [
      {
        certainty: 'confirmed' as const,
        evidenceSourcePaths: [],
        kind: 'entry-render' as const,
        label: 'Selected',
        occurrenceStart: 0,
        sourcePath: selectedPath,
        wrapperNames: [],
      },
      {
        certainty: 'confirmed' as const,
        evidenceSourcePaths: [],
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
