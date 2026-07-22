/** Verifies generic sloppy-CommonJS recovery without weakening authored or strict JavaScript. */
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, type Metafile } from 'esbuild';
import { describe, expect, it } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import {
  createPreviewLegacyCommonJsGlobalDefines,
  discoverPreviewLegacyCommonJsGlobals,
} from '../../../src/adapters/esbuild/previewLegacyCommonJsGlobalDiscovery';

const WORKSPACE_ROOT = path.resolve('/workspace');
const TARGET_PATH = path.join(WORKSPACE_ROOT, 'src', 'Target.tsx');
const LEGACY_PACKAGE_PATH = path.join(WORKSPACE_ROOT, 'node_modules', 'legacy-hash', 'hash.min.js');

/** Creates one request used only to restore relative metafile inputs to trusted absolute paths. */
function createRequest(): PreviewBuildRequest {
  return {
    dependencySnapshots: [],
    documentPath: TARGET_PATH,
    language: 'tsx',
    renderMode: 'page-inspector',
    sourceText: 'export const Target = () => <main />;',
    workspaceRoot: WORKSPACE_ROOT,
  };
}

/** Creates exact reached-input metadata without requiring fixture files on disk. */
function createMetafile(sourcePaths: readonly string[]): Metafile {
  return {
    inputs: Object.fromEntries(
      sourcePaths.map((sourcePath) => [
        path.relative(WORKSPACE_ROOT, sourcePath),
        { bytes: 256, imports: [] },
      ]),
    ),
    outputs: {},
  };
}

describe('preview legacy CommonJS globals', () => {
  /** Detects the md5-jkmyers shape and maps its sloppy write back to browser-global semantics. */
  it('recovers assignment-only globals in reached non-strict CommonJS packages', async () => {
    const legacySource = `
      !function(root, factory) {
        if (typeof exports === 'object') module.exports = factory();
        else root.hash = factory();
      }(this, function() {
        function digest(value) { txt = ''; return value + txt; }
        digest('self-test');
        return digest;
      });
    `;
    const plan = await discoverPreviewLegacyCommonJsGlobals({
      currentGlobalNames: [],
      metafile: createMetafile([LEGACY_PACKAGE_PATH]),
      readSource: (sourcePath) =>
        Promise.resolve(
          path.normalize(sourcePath) === path.normalize(LEGACY_PACKAGE_PATH)
            ? legacySource
            : undefined,
        ),
      request: createRequest(),
    });
    const result = await build({
      bundle: true,
      define: createPreviewLegacyCommonJsGlobalDefines(plan.globalNames),
      format: 'iife',
      platform: 'browser',
      stdin: {
        contents: `function digest(value) { txt = ''; return value + txt; }
          globalThis.__legacyResult = digest('ready');`,
        loader: 'js',
      },
      write: false,
    });
    const runtimeGlobal: Record<string, unknown> = {};
    runInNewContext(result.outputFiles[0]?.text ?? '', { globalThis: runtimeGlobal });

    expect(plan).toEqual({ changed: true, globalNames: ['txt'] });
    expect(createPreviewLegacyCommonJsGlobalDefines(plan.globalNames)).toEqual({
      txt: 'globalThis.txt',
    });
    expect(runtimeGlobal).toMatchObject({ __legacyResult: 'ready', txt: '' });
  });

  /** Keeps declarations, read-only globals, and explicitly strict package defects untouched. */
  it('does not rewrite declared, read-only, or strict identifiers', async () => {
    const sources = new Map<string, string>([
      [
        path.normalize(LEGACY_PACKAGE_PATH),
        `'use strict'; var txt; module.exports = () => { txt = ''; return externalClock(); };`,
      ],
      [
        path.normalize(path.join(WORKSPACE_ROOT, 'node_modules', 'reader', 'index.js')),
        `module.exports = () => missingRuntimeValue;`,
      ],
    ]);
    const plan = await discoverPreviewLegacyCommonJsGlobals({
      currentGlobalNames: [],
      metafile: createMetafile([...sources.keys()]),
      readSource: (sourcePath) => Promise.resolve(sources.get(path.normalize(sourcePath))),
      request: createRequest(),
    });

    expect(plan).toEqual({ changed: false, globalNames: [] });
  });

  /** Never converts an authored undeclared assignment into an extension-supplied global. */
  it('excludes workspace source even when it resembles CommonJS', async () => {
    const authoredPath = path.join(WORKSPACE_ROOT, 'src', 'legacyLike.js');
    const plan = await discoverPreviewLegacyCommonJsGlobals({
      currentGlobalNames: [],
      metafile: createMetafile([authoredPath]),
      readSource: () => Promise.resolve(`module.exports = () => { accidental = true; };`),
      request: createRequest(),
    });

    expect(plan).toEqual({ changed: false, globalNames: [] });
  });

  /** Removes a stale cached rewrite when the dependency is no longer part of the selected graph. */
  it('invalidates obsolete hot-build globals', async () => {
    const plan = await discoverPreviewLegacyCommonJsGlobals({
      currentGlobalNames: ['txt'],
      metafile: createMetafile([]),
      readSource: () => Promise.resolve(undefined),
      request: createRequest(),
    });

    expect(plan).toEqual({ changed: true, globalNames: [] });
  });
});
