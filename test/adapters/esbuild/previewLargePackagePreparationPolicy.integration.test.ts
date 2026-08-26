/**
 * Exercises the selected-corridor/workspace large-package barrel policy through real esbuild builds.
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
   * Selected-corridor preparation preserves the authentic package root because its own exact
   * package-demand projection already controls graph reachability. Workspace-complete preparation
   * may project exact leaves, but it must preserve semantics.
   */
  it('uses the authentic root in corridor builds and exact projections in workspace builds', async () => {
    const fixture = await createPreparationPolicyFixture();
    try {
      const [corridorResult, workspaceResult] = await Promise.all([
        buildFixture(fixture, true),
        buildFixture(fixture, false),
      ]);

      const corridorValue = executePreview(corridorResult);
      const workspaceValue = executePreview(workspaceResult);

      expect(corridorValue).toEqual(['icon-000', 'icon-255']);
      expect(workspaceValue).toEqual(corridorValue);
      expect(hasInput(corridorResult, 'dist/index.js')).toBe(true);
      expect(hasInput(corridorResult, 'dist/Icon127.js')).toBe(true);
      expect(hasInput(workspaceResult, 'dist/index.js')).toBe(false);
      expect(hasInput(workspaceResult, 'dist/Icon000.js')).toBe(true);
      expect(hasInput(workspaceResult, 'dist/Icon255.js')).toBe(true);
      expect(hasInput(workspaceResult, 'dist/Icon127.js')).toBe(false);
    } finally {
      await fixture.dispose();
    }
  });
});

/**
 * Creates a side-effect-free package whose root barrel has enough direct exports to activate the
 * broad optimizer. Every leaf is real because the corridor build resolves the authored root graph.
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
  selectedCorridorPreparation: boolean,
): Promise<BuildResult> {
  return await build({
    absWorkingDir: fixture.workspaceRoot,
    bundle: true,
    entryPoints: [fixture.entryPath],
    format: 'cjs',
    logLevel: 'silent',
    metafile: true,
    outdir: path.join(
      fixture.workspaceRoot,
      selectedCorridorPreparation ? '.preview-corridor' : '.preview-workspace',
    ),
    platform: 'browser',
    plugins: [
      createPreviewMissingSourceFallbackPlugin({
        selectedCorridorPreparation,
        staticModuleResolver: {
          resolve: (specifier) =>
            specifier === PACKAGE_NAME
              ? path.join(fixture.workspaceRoot, 'node_modules', PACKAGE_NAME, 'dist', 'index.js')
              : undefined,
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
