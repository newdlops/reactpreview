/**
 * Runs real Tailwind releases through the preview Tailwind pipeline to measure, per release, which
 * compile strategies work and whether a representative stylesheet compiles completely.
 *
 * This is developer tooling for `scripts/pretrain-tailwind-strategies.mjs`; it never runs inside the
 * extension. Each release is installed outside every project, mounted as a managed-store fallback
 * like the extension's dependency store, and exercised with a fixture that covers the features the
 * preview relies on: snapshot class candidates, a configuration or `@theme` token, `@apply` of that
 * token, and a remote web-font `@import`. The measured strategy outcomes become the read-only seed
 * that lets fresh installs skip self-tests for known releases.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import type { PreviewSourceSnapshot } from '../../domain/preview';
import {
  PreviewAdapterStrategyLearner,
  type PreviewAdapterStrategyDocument,
} from '../esbuild/previewAdapterStrategyLearner';
import { collectPreviewTailwindStrategyCandidates } from '../esbuild/previewTailwindImplementation';
import { createPreviewTailwindPlugin } from '../esbuild/previewTailwindPlugin';
import { PREVIEW_TAILWIND_STRATEGY_FAMILY } from '../esbuild/previewTailwindStrategySelection';

const BRAND_COLOR = '#127c9a';
const FONT_IMPORT = 'https://fonts.googleapis.com/css2?family=Inter&display=swap';
/** Failures that depend only on the release, not on the machine, and may therefore be seeded. */
const ENVIRONMENT_INDEPENDENT_FAILURE = /directly as a PostCSS plugin|moved to a separate package/u;

/** One installed release. */
export interface PreviewTailwindMatrixInstall {
  /** `node_modules` directory containing `tailwindcss` (and the v4 adapter when applicable). */
  readonly nodeModulesPath: string;
  readonly version: string;
}

/** Self-test result of one strategy for one release. */
export interface PreviewTailwindStrategyMeasurement {
  readonly durationMs: number;
  /** Whether the result would hold on every machine, so it may be shipped in the seed. */
  readonly environmentIndependent: boolean;
  readonly error?: string;
  readonly passed: boolean;
  readonly strategy: string;
}

/** Full pipeline result for one release. */
export interface PreviewTailwindPipelineMeasurement {
  /** Named feature checks on the compiled stylesheet. */
  readonly checks: Readonly<Record<string, boolean>>;
  readonly durationMs: number;
  readonly error?: string;
  readonly warnings: readonly string[];
}

/** Everything measured for one release. */
export interface PreviewTailwindMatrixRow {
  /** Same fixture with the fast-preview bounded source discovery the extension uses first. */
  readonly boundedPipeline: PreviewTailwindPipelineMeasurement;
  readonly features: readonly number[];
  readonly measurements: readonly PreviewTailwindStrategyMeasurement[];
  readonly packageKey: string;
  readonly pipeline: PreviewTailwindPipelineMeasurement;
  /** Strategy the version rules alone would use. */
  readonly ruleStrategy?: string;
  readonly version: string;
}

/**
 * Measures every install sequentially.
 *
 * @param installs Releases to measure.
 * @param workRoot Scratch directory for generated fixture projects.
 * @returns One row per release, in input order.
 */
export async function runPreviewTailwindStrategyMatrix(
  installs: readonly PreviewTailwindMatrixInstall[],
  workRoot: string,
): Promise<readonly PreviewTailwindMatrixRow[]> {
  await mkdir(workRoot, { recursive: true });
  const rows: PreviewTailwindMatrixRow[] = [];
  for (const install of installs) {
    const fixtureRoot = await mkdtemp(path.join(workRoot, `fixture-${install.version}-`));
    try {
      await writeFixture(fixtureRoot, install.version);
      rows.push(await measureRelease(install, fixtureRoot));
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  }
  return rows;
}

/**
 * Trains a learner on the seedable measurements and exports its document as the shipped seed.
 *
 * @param rows Matrix rows.
 * @returns Seed document with exact outcomes and trained heads.
 */
export function createPreviewAdapterStrategySeed(
  rows: readonly PreviewTailwindMatrixRow[],
): PreviewAdapterStrategyDocument {
  const learner = new PreviewAdapterStrategyLearner({ now: () => 0 });
  for (let epoch = 0; epoch < 8; epoch += 1) {
    for (const row of rows) {
      for (const measurement of row.measurements) {
        if (!measurement.environmentIndependent) continue;
        learner.record(
          PREVIEW_TAILWIND_STRATEGY_FAMILY,
          row.packageKey,
          row.features,
          measurement.strategy,
          measurement.passed,
        );
      }
    }
  }
  return learner.exportDocument();
}

/** Builds the fixture through the real plugin, then self-tests every loadable strategy. */
async function measureRelease(
  install: PreviewTailwindMatrixInstall,
  fixtureRoot: string,
): Promise<PreviewTailwindMatrixRow> {
  const pipeline = await measurePipeline(install, fixtureRoot, false);
  const boundedPipeline = await measurePipeline(install, fixtureRoot, true);
  const candidates = collectPreviewTailwindStrategyCandidates(fixtureRoot, [
    install.nodeModulesPath,
  ]);
  const measurements: PreviewTailwindStrategyMeasurement[] = [];
  for (const implementation of candidates?.implementations ?? []) {
    const strategy = implementation.strategy ?? implementation.kind;
    const started = performance.now();
    let passed = false;
    let error: string | undefined;
    try {
      passed = (await implementation.selfTest?.()) === true;
    } catch (caught) {
      error = (caught instanceof Error ? caught.message : String(caught)).slice(0, 300);
    }
    measurements.push({
      durationMs: Math.round(performance.now() - started),
      environmentIndependent:
        passed || (error !== undefined && ENVIRONMENT_INDEPENDENT_FAILURE.test(error)),
      ...(error === undefined ? {} : { error }),
      passed,
      strategy,
    });
  }
  return {
    boundedPipeline,
    features: candidates?.features ?? [],
    measurements,
    packageKey: candidates?.packageKey ?? `tailwindcss@${install.version}`,
    pipeline,
    ...(candidates?.implementations[0]?.strategy === undefined
      ? {}
      : { ruleStrategy: candidates.implementations[0].strategy }),
    version: install.version,
  };
}

/** Compiles the fixture stylesheet exactly as a preview build would. */
async function measurePipeline(
  install: PreviewTailwindMatrixInstall,
  fixtureRoot: string,
  boundedSourceDiscovery: boolean,
): Promise<PreviewTailwindPipelineMeasurement> {
  const snapshot: PreviewSourceSnapshot = {
    documentPath: path.join(fixtureRoot, 'src', 'Card.tsx'),
    language: 'tsx',
    sourceText: 'export const Card = () => <div className="flex text-brand mt-3 card" />;',
  };
  const savedSnapshot: PreviewSourceSnapshot = {
    documentPath: path.join(fixtureRoot, 'src', 'Saved.tsx'),
    language: 'tsx',
    sourceText: 'export const Saved = () => <section className="grid" />;',
  };
  const started = performance.now();
  try {
    const result = await build({
      absWorkingDir: fixtureRoot,
      bundle: true,
      entryPoints: [path.join(fixtureRoot, 'src', 'index.css')],
      logLevel: 'silent',
      outdir: path.join(fixtureRoot, 'out'),
      plugins: [
        createPreviewTailwindPlugin({
          adapterStrategyLearner: new PreviewAdapterStrategyLearner(),
          boundedSourceDiscovery,
          fallbackNodeModulesPaths: [install.nodeModulesPath],
          projectRoot: fixtureRoot,
          // Like the compiler, pass the page corridor's saved files as candidates too.
          readSourceSnapshots: () => [snapshot, savedSnapshot],
          workspaceRoot: fixtureRoot,
        }),
      ],
      write: false,
    });
    const css = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
    // v2 writes `rgba(18, 124, 154, …)`, v3 `rgb(18 124 154 / …)`, v4 `var(--color-brand)`.
    const brandVariable = css.includes(`--color-brand: ${BRAND_COLOR}`)
      ? '|var\\(--color-brand\\)'
      : '';
    const brand = new RegExp(`${BRAND_COLOR}|rgba?\\(18[ ,]+124[ ,]+154${brandVariable}`, 'iu');
    const warnings = result.warnings.map((warning) => warning.text);
    return {
      checks: {
        applyResolved: !css.includes('@apply') && readRule(css, '.card') !== undefined,
        applyUsesToken: brand.test(readRule(css, '.card') ?? ''),
        noFailSoft: !warnings.some((text) => /retained|failed|could not/iu.test(text)),
        remoteImportKept: css.includes('fonts.googleapis.com'),
        savedFileUtility: /\.grid\b[^{]*\{[^}]*display:\s*grid/u.test(css),
        snapshotUtility: /\.mt-3\b[^{]*\{[^}]*margin-top/u.test(css),
        themeToken: brand.test(readRule(css, '.text-brand') ?? ''),
      },
      durationMs: Math.round(performance.now() - started),
      warnings,
    };
  } catch (caught) {
    return {
      checks: {},
      durationMs: Math.round(performance.now() - started),
      error: (caught instanceof Error ? caught.message : String(caught)).slice(0, 300),
      warnings: [],
    };
  }
}

/** Returns the declarations of the first rule whose selector list contains the selector. */
function readRule(css: string, selector: string): string | undefined {
  const escaped = selector.replaceAll('.', '\\.');
  return new RegExp(`${escaped}(?![\\w-])[^{}]*\\{([^}]*)\\}`, 'u').exec(css)?.[1];
}

/** Writes the generation-specific fixture project; nothing in it is ever executed. */
async function writeFixture(fixtureRoot: string, version: string): Promise<void> {
  const major = Number.parseInt(version, 10);
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
  await writeFile(path.join(fixtureRoot, 'package.json'), '{"private":true}', 'utf8');
  // A saved page file: the scan (v4) or content globs (v2/v3) must find its classes.
  await writeFile(
    path.join(fixtureRoot, 'src', 'Saved.tsx'),
    'export const Saved = () => <section className="grid" />;',
    'utf8',
  );
  const fontImport = `@import url("${FONT_IMPORT}");`;
  if (major >= 4) {
    await writeFile(
      path.join(fixtureRoot, 'src', 'index.css'),
      [
        fontImport,
        '@import "tailwindcss";',
        `@theme { --color-brand: ${BRAND_COLOR}; }`,
        '.card { @apply bg-brand p-2; }',
      ].join('\n'),
      'utf8',
    );
    return;
  }
  await writeFile(
    path.join(fixtureRoot, 'tailwind.config.js'),
    `module.exports = { theme: { extend: { colors: { brand: '${BRAND_COLOR}' } } } };`,
    'utf8',
  );
  await writeFile(
    path.join(fixtureRoot, 'src', 'index.css'),
    [
      fontImport,
      '@tailwind base;',
      '@tailwind components;',
      '@tailwind utilities;',
      '.card { @apply bg-brand p-2; }',
    ].join('\n'),
    'utf8',
  );
}
