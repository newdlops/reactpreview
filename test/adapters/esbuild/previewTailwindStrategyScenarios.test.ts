/**
 * Rehearses plausible future Tailwind release breakages against strategy selection and the shipped
 * seed, with fake packages so the scenarios run offline and deterministically.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PreviewAdapterStrategyLearner } from '../../../src/adapters/esbuild/previewAdapterStrategyLearner';
import { PREVIEW_ADAPTER_STRATEGY_SEED } from '../../../src/adapters/esbuild/previewAdapterStrategySeed';
import {
  PREVIEW_TAILWIND_STRATEGY_FAMILY as FAMILY,
  selectPreviewTailwindImplementation,
} from '../../../src/adapters/esbuild/previewTailwindStrategySelection';

const PROBE_CALLS = '__previewTailwindScenarioProbeCalls';
/** major/10, minor/50, style entry, index.css, lib/index.js, postcss dependency, v4 adapter. */
const V3_SHAPE = [0.39, 0.1, 0, 0, 1, 1, 0];
const V5_SHAPE = [0.5, 0, 1, 1, 0, 0, 1];
const temporaryRoots: string[] = [];

afterEach(async () => {
  Reflect.deleteProperty(globalThis, PROBE_CALLS);
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

/** Fake release shape. */
interface FakeRelease {
  /** Installs a v4-style `@tailwindcss/postcss` whose compile throws. */
  readonly brokenAdapter?: boolean;
  /** How the `tailwindcss` main export behaves. */
  readonly main: 'content-plugin' | 'default-export' | 'v4-entry';
  readonly version: string;
}

describe('Tailwind strategy scenarios', () => {
  /** A future release whose PostCSS adapter breaks while the plain plugin works again. */
  it('recovers when the rule-picked v4 adapter fails on a future release', async () => {
    const projectRoot = await createProject({
      brokenAdapter: true,
      main: 'content-plugin',
      version: '5.0.0',
    });
    const learner = new PreviewAdapterStrategyLearner({ seed: PREVIEW_ADAPTER_STRATEGY_SEED });

    const selected = await selectPreviewTailwindImplementation(
      projectRoot,
      [],
      projectRoot,
      learner,
    );

    expect(selected?.strategy).toBe('legacy-content');
    expect(learner.readOutcome(FAMILY, 'tailwindcss@5.0.0', 'v4-postcss')).toBe(false);
    expect(learner.readOutcome(FAMILY, 'tailwindcss@5.0.0', 'legacy-content')).toBe(true);
  });

  /** A release that exports its plugin only as `default` still compiles. */
  it('accepts a plugin exported only as default', async () => {
    const projectRoot = await createProject({ main: 'default-export', version: '3.9.0' });
    const learner = new PreviewAdapterStrategyLearner();

    const selected = await selectPreviewTailwindImplementation(
      projectRoot,
      [],
      projectRoot,
      learner,
    );

    expect(selected?.strategy).toBe('legacy-content');
    expect(learner.readOutcome(FAMILY, 'tailwindcss@3.9.0', 'legacy-content')).toBe(true);
  });

  /** With no working strategy the rule pick is kept, so the stylesheet fails softly as before. */
  it('keeps the rule pick when every strategy fails', async () => {
    const projectRoot = await createProject({ main: 'v4-entry', version: '4.9.0' });
    const learner = new PreviewAdapterStrategyLearner();

    const selected = await selectPreviewTailwindImplementation(
      projectRoot,
      [],
      projectRoot,
      learner,
    );

    expect(selected?.strategy).toBe('legacy-content');
    expect(learner.readOutcome(FAMILY, 'tailwindcss@4.9.0', 'legacy-content')).toBe(false);
    expect(learner.readOutcome(FAMILY, 'tailwindcss@4.9.0', 'legacy-purge')).toBe(false);
  });

  /** A release measured offline is used without a self-test on the first build. */
  it('skips the self-test for a release in the shipped seed', async () => {
    const projectRoot = await createProject({ main: 'content-plugin', version: '3.4.19' });
    const learner = new PreviewAdapterStrategyLearner({ seed: PREVIEW_ADAPTER_STRATEGY_SEED });

    const selected = await selectPreviewTailwindImplementation(
      projectRoot,
      [],
      projectRoot,
      learner,
    );

    expect(selected?.strategy).toBe('legacy-content');
    expect(Reflect.get(globalThis, PROBE_CALLS)).toBeUndefined();
  });

  /** The pre-trained heads rank v4-shaped and v3-shaped unseen releases differently. */
  it('ranks unseen releases from the seed heads', () => {
    const learner = new PreviewAdapterStrategyLearner({ seed: PREVIEW_ADAPTER_STRATEGY_SEED });
    const strategies = ['legacy-content', 'v4-postcss'];

    expect(learner.rank(FAMILY, 'tailwindcss@5.0.0', V5_SHAPE, strategies)).toEqual([
      'v4-postcss',
      'legacy-content',
    ]);
    expect(learner.rank(FAMILY, 'tailwindcss@3.9.0', V3_SHAPE, [...strategies].reverse())).toEqual([
      'legacy-content',
      'v4-postcss',
    ]);
  });

  /** Local evidence overrides the seed, and the seed is never written to the user's store. */
  it('layers local evidence over the seed without persisting the seed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'react-preview-seed-layer-'));
    temporaryRoots.push(root);
    const storePath = path.join(root, 'adapter-strategies.json');
    const learner = new PreviewAdapterStrategyLearner({
      seed: PREVIEW_ADAPTER_STRATEGY_SEED,
      storePath,
    });
    expect(learner.readOutcome(FAMILY, 'tailwindcss@3.4.19', 'legacy-content')).toBe(true);

    learner.record(FAMILY, 'tailwindcss@3.4.19', V3_SHAPE, 'legacy-content', false);

    expect(learner.readOutcome(FAMILY, 'tailwindcss@3.4.19', 'legacy-content')).toBe(false);
    const stored = JSON.parse(await readFile(storePath, 'utf8')) as {
      readonly outcomes: Record<string, unknown>;
    };
    expect(Object.keys(stored.outcomes)).toEqual([`${FAMILY}|tailwindcss@3.4.19|legacy-content`]);
  });
});

/** Installs a structural PostCSS plus one fake Tailwind release shape. */
async function createProject(release: FakeRelease): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-tailwind-scenario-'));
  temporaryRoots.push(projectRoot);
  const modules = path.join(projectRoot, 'node_modules');
  const tailwindRoot = path.join(modules, 'tailwindcss');
  const v4Layout = release.main !== 'content-plugin' || release.brokenAdapter === true;
  await Promise.all([
    mkdir(path.join(modules, 'postcss'), { recursive: true }),
    mkdir(path.join(tailwindRoot, 'lib'), { recursive: true }),
  ]);
  const plugin = [
    '(configuration) => ({',
    '  transform: async () => {',
    `    globalThis.${PROBE_CALLS} = (globalThis.${PROBE_CALLS} ?? 0) + 1;`,
    '    const raw = (configuration.content ?? []).map((entry) => entry?.raw ?? "").join(" ");',
    '    return { css: raw.includes("flex") ? ".flex { display: flex; }" : ".empty {}", messages: [] };',
    '  },',
    '})',
  ].join('\n');
  const main =
    release.main === 'v4-entry'
      ? 'module.exports = () => { throw new Error("It looks like you\'re trying to use `tailwindcss` directly as a PostCSS plugin."); };'
      : release.main === 'default-export'
        ? `module.exports = { default: ${plugin} };`
        : `module.exports = ${plugin};`;
  await Promise.all([
    writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
    writeFile(
      path.join(modules, 'postcss', 'package.json'),
      '{"name":"postcss","version":"8.4.0","main":"index.js"}',
      'utf8',
    ),
    writeFile(
      path.join(modules, 'postcss', 'index.js'),
      'module.exports = (plugins) => ({ process: async (source, options) => { let result = { css: source, messages: [] }; for (const plugin of plugins) result = await plugin.transform(result.css, options); return result; } });',
      'utf8',
    ),
    writeFile(
      path.join(tailwindRoot, 'package.json'),
      JSON.stringify({
        dependencies: v4Layout ? {} : { postcss: '^8' },
        main: 'lib/index.js',
        name: 'tailwindcss',
        ...(v4Layout ? { style: 'index.css' } : {}),
        version: release.version,
      }),
      'utf8',
    ),
    writeFile(path.join(tailwindRoot, 'lib', 'index.js'), main, 'utf8'),
    ...(v4Layout ? [writeFile(path.join(tailwindRoot, 'index.css'), '', 'utf8')] : []),
  ]);
  if (release.brokenAdapter === true) {
    const adapterRoot = path.join(modules, '@tailwindcss', 'postcss');
    await mkdir(adapterRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(adapterRoot, 'package.json'),
        JSON.stringify({
          main: 'index.js',
          name: '@tailwindcss/postcss',
          version: release.version,
        }),
        'utf8',
      ),
      writeFile(
        path.join(adapterRoot, 'index.js'),
        'module.exports = () => ({ transform: async () => { throw new Error("adapter API changed"); } });',
        'utf8',
      ),
    ]);
  }
  return projectRoot;
}
