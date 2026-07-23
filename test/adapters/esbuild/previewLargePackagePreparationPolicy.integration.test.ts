/**
 * Exercises the fast/full large-package barrel policy through real esbuild builds.
 * The fixture intentionally crosses the production optimizer's 256-export threshold so the test
 * catches both accidental fast-path registration and accidental full-path projection removal.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build, type BuildResult } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewMissingSourceFallbackPlugin } from '../../../src/adapters/esbuild/previewMissingSourceFallbackPlugin';

const PACKAGE_NAME = 'preview-policy-icons';
const EXPORT_COUNT = 256;

/** Filesystem paths and cleanup owned by one isolated integration fixture. */
interface PreparationPolicyFixture {
  readonly dispose: () => Promise<void>;
  readonly entryPath: string;
  readonly workspaceRoot: string;
}

describe('large-package barrel preparation policy', () => {
  /**
   * Fast preparation must preserve the authentic package root so first paint avoids graph-wide
   * projection work. Full preparation may project exact leaves, but it must preserve semantics.
   */
  it('uses the authentic root in fast builds and exact projections in full builds', async () => {
    const fixture = await createPreparationPolicyFixture();
    try {
      const [fastResult, fullResult] = await Promise.all([
        buildFixture(fixture, true),
        buildFixture(fixture, false),
      ]);

      const fastValue = executePreview(fastResult);
      const fullValue = executePreview(fullResult);

      expect(fastValue).toEqual(['icon-000', 'icon-255']);
      expect(fullValue).toEqual(fastValue);
      expect(hasInput(fastResult, 'dist/index.js')).toBe(true);
      expect(hasInput(fastResult, 'dist/Icon127.js')).toBe(true);
      expect(hasInput(fullResult, 'dist/index.js')).toBe(false);
      expect(hasInput(fullResult, 'dist/Icon000.js')).toBe(true);
      expect(hasInput(fullResult, 'dist/Icon255.js')).toBe(true);
      expect(hasInput(fullResult, 'dist/Icon127.js')).toBe(false);
    } finally {
      await fixture.dispose();
    }
  });
});

/**
 * Creates a side-effect-free package whose root barrel has enough direct exports to activate the
 * full optimizer. Every leaf is real because the fast build must resolve the authored root graph.
 */
async function createPreparationPolicyFixture(): Promise<PreparationPolicyFixture> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-barrel-policy-'));
  const packageRoot = path.join(workspaceRoot, 'node_modules', PACKAGE_NAME);
  const distributionRoot = path.join(packageRoot, 'dist');
  const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
  await Promise.all([
    mkdir(distributionRoot, { recursive: true }),
    mkdir(path.dirname(entryPath), { recursive: true }),
  ]);
  await writeFile(
    path.join(packageRoot, 'package.json'),
    `${JSON.stringify({
      exports: {
        '.': './dist/index.js',
        './*': './dist/*.js',
      },
      name: PACKAGE_NAME,
      sideEffects: false,
      type: 'module',
    })}\n`,
    'utf8',
  );

  const exportNames = Array.from(
    { length: EXPORT_COUNT },
    (_, index) => `Icon${index.toString().padStart(3, '0')}`,
  );
  await Promise.all(
    exportNames.map(async (exportName, index) => {
      const value = `icon-${index.toString().padStart(3, '0')}`;
      await writeFile(
        path.join(distributionRoot, `${exportName}.js`),
        `export default ${JSON.stringify(value)};\n`,
        'utf8',
      );
    }),
  );
  await writeFile(
    path.join(distributionRoot, 'index.js'),
    exportNames
      .map((exportName) => `export { default as ${exportName} } from './${exportName}.js';`)
      .join('\n'),
    'utf8',
  );
  await writeFile(
    entryPath,
    [
      `import { Icon000, Icon255 } from '${PACKAGE_NAME}';`,
      'globalThis.previewPolicyResult = [Icon000, Icon255];',
    ].join('\n'),
    'utf8',
  );

  return {
    dispose: async () => {
      await rm(workspaceRoot, { force: true, recursive: true });
    },
    entryPath,
    workspaceRoot,
  };
}

/** Runs the production fallback composition with only its preparation policy varied. */
async function buildFixture(
  fixture: PreparationPolicyFixture,
  fastPreparation: boolean,
): Promise<BuildResult> {
  return await build({
    absWorkingDir: fixture.workspaceRoot,
    bundle: true,
    entryPoints: [fixture.entryPath],
    format: 'cjs',
    logLevel: 'silent',
    metafile: true,
    outdir: path.join(fixture.workspaceRoot, fastPreparation ? '.preview-fast' : '.preview-full'),
    platform: 'browser',
    plugins: [
      createPreviewMissingSourceFallbackPlugin({
        fastPreparation,
        staticModuleResolver: {
          resolve: () => undefined,
          resolveMissingPathAliasCandidate: () => undefined,
        },
        workspaceRoot: fixture.workspaceRoot,
      }),
    ],
    write: false,
  });
}

/** Executes one in-memory browser artifact without sharing mutable globals between policy cases. */
function executePreview(result: BuildResult): unknown {
  const context: Record<string, unknown> = { exports: {}, module: { exports: {} } };
  context.globalThis = context;
  vm.runInNewContext(result.outputFiles?.[0]?.text ?? '', context);
  return context.previewPolicyResult;
}

/** Matches a normalized metafile input suffix without depending on temporary directory names. */
function hasInput(result: BuildResult, suffix: string): boolean {
  const normalizedSuffix = suffix.replaceAll('\\', '/');
  return Object.keys(result.metafile?.inputs ?? {}).some((input) =>
    input.replaceAll('\\', '/').endsWith(normalizedSuffix),
  );
}
