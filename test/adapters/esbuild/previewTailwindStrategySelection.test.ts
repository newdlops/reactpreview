/** Verifies that a self-tested strategy replaces a broken rule pick and is remembered. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PreviewAdapterStrategyLearner } from '../../../src/adapters/esbuild/previewAdapterStrategyLearner';
import {
  PREVIEW_TAILWIND_STRATEGY_FAMILY as FAMILY,
  selectPreviewTailwindImplementation,
} from '../../../src/adapters/esbuild/previewTailwindStrategySelection';

const PROBE_CALLS = '__previewTailwindStrategyProbeCalls';
const temporaryRoots: string[] = [];

afterEach(async () => {
  Reflect.deleteProperty(globalThis, PROBE_CALLS);
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('selectPreviewTailwindImplementation', () => {
  /** A pre-release that already needs `content` breaks the `purge` rule for majors below 3. */
  it('replaces a failing rule pick with a verified strategy and remembers it', async () => {
    const projectRoot = await createProject('2.9.0');
    const learner = new PreviewAdapterStrategyLearner();

    const first = await selectPreviewTailwindImplementation(projectRoot, [], projectRoot, learner);
    const probeCallsAfterFirst = readProbeCalls();
    const second = await selectPreviewTailwindImplementation(projectRoot, [], projectRoot, learner);

    expect(first?.strategy).toBe('legacy-content');
    expect(learner.readOutcome(FAMILY, 'tailwindcss@2.9.0', 'legacy-purge')).toBe(false);
    expect(learner.readOutcome(FAMILY, 'tailwindcss@2.9.0', 'legacy-content')).toBe(true);
    expect(probeCallsAfterFirst).toBe(2);
    expect(second?.strategy).toBe('legacy-content');
    expect(readProbeCalls()).toBe(probeCallsAfterFirst);
  });

  /** Without learning, or when the rule pick passes, the rule pick is used unchanged. */
  it('keeps the rule pick when it passes or when no learner is configured', async () => {
    const legacyRule = await createProject('2.9.0');
    const currentRule = await createProject('3.4.19');
    const learner = new PreviewAdapterStrategyLearner();

    expect((await selectPreviewTailwindImplementation(legacyRule, [], legacyRule))?.strategy).toBe(
      'legacy-purge',
    );
    expect(
      (await selectPreviewTailwindImplementation(currentRule, [], currentRule, learner))?.strategy,
    ).toBe('legacy-content');
    expect(learner.readOutcome(FAMILY, 'tailwindcss@3.4.19', 'legacy-purge')).toBeUndefined();
  });
});

/** Reads how many probe compilations the fake Tailwind package performed. */
function readProbeCalls(): number {
  const calls: unknown = Reflect.get(globalThis, PROBE_CALLS);
  return typeof calls === 'number' ? calls : 0;
}

/**
 * Installs a structural PostCSS and a Tailwind plugin that only honors the `content` key, so the
 * version rule's `purge` choice for 2.x produces no utilities.
 */
async function createProject(version: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-tailwind-strategy-'));
  temporaryRoots.push(projectRoot);
  const postcssRoot = path.join(projectRoot, 'node_modules/postcss');
  const tailwindRoot = path.join(projectRoot, 'node_modules/tailwindcss');
  await Promise.all([
    mkdir(postcssRoot, { recursive: true }),
    mkdir(path.join(tailwindRoot, 'lib'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
    writeFile(
      path.join(postcssRoot, 'package.json'),
      '{"name":"postcss","version":"8.4.0","main":"index.js"}',
      'utf8',
    ),
    writeFile(
      path.join(postcssRoot, 'index.js'),
      [
        'module.exports = (plugins) => ({',
        '  process: async (source, options) => {',
        '    let result = { css: source, messages: [] };',
        '    for (const plugin of plugins) result = await plugin.transform(result.css, options);',
        '    return result;',
        '  },',
        '});',
      ].join('\n'),
      'utf8',
    ),
    writeFile(
      path.join(tailwindRoot, 'package.json'),
      JSON.stringify({
        dependencies: { postcss: '^8' },
        main: 'lib/index.js',
        name: 'tailwindcss',
        version,
      }),
      'utf8',
    ),
    writeFile(
      path.join(tailwindRoot, 'lib/index.js'),
      [
        'module.exports = (configuration) => ({',
        '  transform: async () => {',
        `    globalThis.${PROBE_CALLS} = (globalThis.${PROBE_CALLS} ?? 0) + 1;`,
        '    const raw = (configuration.content ?? []).map((entry) => entry?.raw ?? "").join(" ");',
        '    return { css: raw.includes("flex") ? ".flex { display: flex; }" : ".empty {}", messages: [] };',
        '  },',
        '});',
      ].join('\n'),
      'utf8',
    ),
  ]);
  return projectRoot;
}
