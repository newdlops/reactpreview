/** Exercises the final aggregate byte guard without allocating large buffers in the test process. */
import path from 'node:path';
import type { Metafile, OutputFile } from 'esbuild';
import { describe, expect, it } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import {
  assertOutputSize,
  collectPreviewBuildDependencies,
  decodePreviewMetafileFileDependency,
} from '../../../src/adapters/esbuild/previewBuildResult';
import {
  PREVIEW_ASSET_NAMESPACE,
  PREVIEW_DATA_URL_NAMESPACE,
  PREVIEW_INSPECTOR_ROOT_NAMESPACE,
  PREVIEW_SNAPSHOT_NAMESPACE,
  PREVIEW_THEME_BRIDGE_NAMESPACE,
} from '../../../src/adapters/esbuild/previewPluginProtocol';
import {
  PREVIEW_IMPORT_META_ENV_DEFINE_INPUT,
  PREVIEW_STDIN_ENTRY_NAME,
} from '../../../src/adapters/esbuild/previewSyntheticInputRegistry';

const MEBIBYTE = 1024 * 1024;

describe('assertOutputSize', () => {
  /** Accepts the expanded default budget and an explicitly larger resource-scoped budget. */
  it('accepts output within the default or configured local limit', () => {
    expect(() => {
      assertOutputSize(createOutputFiles(80));
    }).not.toThrow();
    expect(() => {
      assertOutputSize(createOutputFiles(200), 256);
    }).not.toThrow();
    expect(() => {
      assertOutputSize(createOutputFiles(32), 32);
    }).not.toThrow();
  });

  /** Reports actual size, active setting, and the exact recovery setting when the budget is exceeded. */
  it('returns an actionable error for oversized output', () => {
    expect(() => {
      assertOutputSize(createOutputFiles(40.25), 32);
    }).toThrow(
      'Preview output is 40.3 MiB and exceeds the configured 32 MiB limit. Increase reactPreview.maxOutputSizeMiB up to 512 MiB',
    );
  });

  /** Clamps direct compiler callers so even a malformed request cannot disable the hard guard. */
  it('retains the absolute maximum for out-of-range compiler requests', () => {
    expect(() => {
      assertOutputSize(createOutputFiles(513), 4096);
    }).toThrow('configured 512 MiB limit');
  });
});

describe('collectPreviewBuildDependencies', () => {
  it('recovers declared file-backed inputs before virtual exclusion and deduplicates suffix variants', () => {
    const workspaceRoot = path.resolve('/workspace');
    const documentPath = path.join(workspaceRoot, 'src', 'App.tsx');
    const assetPath = path.join(workspaceRoot, 'assets', 'logo.png');
    const snapshotPath = path.join(workspaceRoot, 'src', 'Dirty.tsx');
    const request = createRequest(workspaceRoot, documentPath);
    const dependencies = collectPreviewBuildDependencies(
      request,
      createMetafile([
        PREVIEW_IMPORT_META_ENV_DEFINE_INPUT,
        `src/${PREVIEW_STDIN_ENTRY_NAME}`,
        'src/App.tsx',
        `${PREVIEW_ASSET_NAMESPACE}:${assetPath}?url#asset-fragment`,
        `${PREVIEW_DATA_URL_NAMESPACE}:assets/logo.png#second-representation`,
        `${PREVIEW_SNAPSHOT_NAMESPACE}:src/Dirty.tsx?editor-snapshot`,
        `${PREVIEW_INSPECTOR_ROOT_NAMESPACE}:descriptor`,
        `${PREVIEW_THEME_BRIDGE_NAMESPACE}:${path.join(workspaceRoot, 'theme.ts')}`,
        'project-custom:filesystem-looking-payload.ts',
      ]),
    );

    expect(dependencies).toEqual([assetPath, documentPath, snapshotPath].sort());
    expect(
      decodePreviewMetafileFileDependency(
        `${PREVIEW_DATA_URL_NAMESPACE}:assets/logo.png?inline`,
        workspaceRoot,
      ),
    ).toEqual({
      dependencyPath: assetPath,
      namespace: PREVIEW_DATA_URL_NAMESPACE,
      payload: 'assets/logo.png?inline',
    });
  });

  it('does not invent a path for an empty dependency-carrying namespace payload', () => {
    expect(
      decodePreviewMetafileFileDependency(`${PREVIEW_ASSET_NAMESPACE}:`, '/workspace'),
    ).toEqual({
      namespace: PREVIEW_ASSET_NAMESPACE,
      payload: '',
    });
  });

  it('excludes only the request-derived exact stdin identity, not a near-match file', () => {
    const workspaceRoot = path.resolve('/workspace');
    const documentPath = path.join(workspaceRoot, 'src', 'App.tsx');
    const nearMatch = `src/${PREVIEW_STDIN_ENTRY_NAME}.saved`;

    expect(
      collectPreviewBuildDependencies(
        createRequest(workspaceRoot, documentPath),
        createMetafile([`src/${PREVIEW_STDIN_ENTRY_NAME}`, nearMatch]),
      ),
    ).toEqual([documentPath, path.join(workspaceRoot, nearMatch)].sort());
  });
});

/** Creates structural esbuild outputs whose byte lengths require no corresponding memory allocation. */
function createOutputFiles(...sizesInMebibytes: readonly number[]): readonly OutputFile[] {
  return sizesInMebibytes.map((sizeInMebibytes, index) => ({
    contents: { byteLength: sizeInMebibytes * MEBIBYTE },
    hash: `fake-${index.toString()}`,
    path: `/virtual/output-${index.toString()}.js`,
    text: '',
  })) as unknown as readonly OutputFile[];
}

function createRequest(workspaceRoot: string, documentPath: string): PreviewBuildRequest {
  return {
    dependencySnapshots: [],
    documentPath,
    language: 'tsx',
    sourceText: 'export default function App() {}',
    workspaceRoot,
  };
}

function createMetafile(inputIdentities: readonly string[]): Metafile {
  return {
    inputs: Object.fromEntries(
      inputIdentities.map((inputIdentity) => [
        inputIdentity,
        { bytes: 1, format: 'esm', imports: [] },
      ]),
    ),
    outputs: {},
  };
}
