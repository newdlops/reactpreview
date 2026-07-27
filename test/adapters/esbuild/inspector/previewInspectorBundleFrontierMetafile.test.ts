import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { verifyPreviewInspectorBundleFrontierMetafile } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontierMetafile';
import type { PreviewCompilerBundleFrontierActivity } from '../../../../src/domain/previewCompilerActivity';

describe('verifyPreviewInspectorBundleFrontierMetafile', () => {
  it('rejects an authored esbuild input that was not admitted by the frozen frontier', () => {
    let caught: unknown;
    try {
      verifyPreviewInspectorBundleFrontierMetafile({
        activity: bundleActivity(),
        authenticSourcePaths: ['/workspace/src/Target.tsx'],
        metafile: {
          inputs: {
            'src/Target.tsx': { bytes: 20, imports: [] },
            'src/Unexpected.ts': { bytes: 20, imports: [] },
            'node_modules/react/index.js': { bytes: 20, imports: [] },
          },
          outputs: {},
        },
        target: '/workspace/src/Target.tsx',
        workspaceRoot: '/workspace',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      reason: 'frontier-mismatch',
      target: '/workspace/src/Target.tsx',
    });
  });

  it('accepts authored frontier inputs and excludes installed dependencies from the assertion', () => {
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile({
        activity: bundleActivity(),
        authenticSourcePaths: ['/workspace/src/Target.tsx'],
        metafile: {
          inputs: {
            '/workspace/src/Target.tsx': { bytes: 20, imports: [] },
            '/workspace/node_modules/react/index.js': { bytes: 20, imports: [] },
            'react-preview-inspector-target:src/Escaped.tsx': { bytes: 20, imports: [] },
          },
          outputs: {},
        },
        target: '/workspace/src/Target.tsx',
        workspaceRoot: '/workspace',
      });
    }).not.toThrow();
  });

  it('requires a selected virtual Page Execution surface to remain in the emitted metafile', () => {
    const options: Parameters<typeof verifyPreviewInspectorBundleFrontierMetafile>[0] = {
      activity: bundleActivity(),
      authenticSourcePaths: ['/workspace/src/Target.tsx'],
      executionSurfaces: [
        {
          id: 'page-slice',
          sourcePath: '/workspace/src/Page.tsx',
          strategy: 'selected-export-slice',
        },
      ],
      metafile: {
        inputs: { '/workspace/src/Target.tsx': { bytes: 20, imports: [] } },
        outputs: {},
      },
      target: '/workspace/src/Target.tsx',
      workspaceRoot: '/workspace',
    };
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile(options);
    }).toThrow('outside its verified module frontier');
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile({
        ...options,
        metafile: {
          ...options.metafile,
          inputs: {
            ...options.metafile.inputs,
            'react-preview-page-execution:page-slice': { bytes: 20, imports: [] },
          },
        },
      });
    }).not.toThrow();
  });

  it('detects an escaped source from an actual workspace-relative esbuild metafile', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-frontier-metafile-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entryPath = path.join(sourceRoot, 'entry.ts');
    const targetPath = path.join(sourceRoot, 'Target.ts');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(
        entryPath,
        "import { target } from './Target'; import { escaped } from './Escaped'; export default target + escaped;",
      ),
      writeFile(targetPath, 'export const target = 1;'),
      writeFile(path.join(sourceRoot, 'Escaped.ts'), 'export const escaped = 2;'),
    ]);
    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      logLevel: 'silent',
      metafile: true,
      outdir: path.join(workspaceRoot, 'out'),
      write: false,
    });
    let caught: unknown;
    try {
      verifyPreviewInspectorBundleFrontierMetafile({
        activity: bundleActivity(),
        authenticSourcePaths: [entryPath, targetPath],
        metafile: result.metafile,
        target: targetPath,
        workspaceRoot,
      });
    } catch (error) {
      caught = error;
    }

    expect(Object.keys(result.metafile.inputs)).toContain('src/Escaped.ts');
    expect(caught).toMatchObject({ reason: 'frontier-mismatch', target: targetPath });
  });
});

/** Supplies the same path-safe bounded activity that the compiler reports before native bundling. */
function bundleActivity(): PreviewCompilerBundleFrontierActivity {
  return {
    analysisCandidateCount: 1,
    authoredEdgeCount: 1,
    corridorSourceCount: 1,
    dependencySnapshotCount: 0,
    discoveryScope: 'selected-corridor' as const,
    discoveryTruncated: false,
    exactModuleCount: 1,
    executableCandidateCount: 1 as const,
    frontierSourceBytes: 20,
    graphAdmission: 'unbounded',
    kind: 'bundle-frontier' as const,
    maximumDepth: 0,
    optionalComponentCount: 0,
    packageDemandSourceCount: 0,
    phase: 'planned' as const,
    preparationMode: 'fast' as const,
    projectedEdgeCount: 0,
    styleSnapshotCount: 0,
    supportModuleCount: 0,
    totalAuthoredModuleCount: 1,
    truncated: false,
    truncationReasons: [],
  };
}
