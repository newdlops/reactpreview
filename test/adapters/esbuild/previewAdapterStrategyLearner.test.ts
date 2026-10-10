/** Verifies verified-outcome memory, feature generalization, and persistence of adapter learning. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PreviewAdapterStrategyLearner } from '../../../src/adapters/esbuild/previewAdapterStrategyLearner';

const STRATEGIES = ['v4-postcss', 'legacy-content'] as const;
/** major/10, minor/50, style entry, index.css, lib/index.js, postcss dependency, v4 adapter. */
const V3_FEATURES = [0.3, 0.08, 0, 0, 1, 1, 0];
const V4_FEATURES = [0.4, 0.06, 1, 1, 0, 0, 1];
const UNSEEN_V5_FEATURES = [0.5, 0, 1, 1, 0, 0, 1];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('PreviewAdapterStrategyLearner', () => {
  /** Verified passes come first and verified failures last, whatever the model says. */
  it('orders verified outcomes ahead of model scores', () => {
    const learner = new PreviewAdapterStrategyLearner();
    learner.record('tailwind', 'tailwindcss@3.4.19', V3_FEATURES, 'v4-postcss', false);
    learner.record('tailwind', 'tailwindcss@3.4.19', V3_FEATURES, 'legacy-content', true);

    expect(learner.rank('tailwind', 'tailwindcss@3.4.19', V3_FEATURES, STRATEGIES)).toEqual([
      'legacy-content',
      'v4-postcss',
    ]);
    expect(learner.readOutcome('tailwind', 'tailwindcss@3.4.19', 'v4-postcss')).toBe(false);
    expect(learner.readOutcome('tailwind', 'tailwindcss@9.9.9', 'v4-postcss')).toBeUndefined();
  });

  /** An unseen release resembling v4 is tried with the v4 adapter first. */
  it('ranks an unseen version by the strategies similar versions needed', () => {
    const learner = new PreviewAdapterStrategyLearner();
    for (let round = 0; round < 6; round += 1) {
      learner.record(
        'tailwind',
        `tailwindcss@3.${String(round)}.0`,
        V3_FEATURES,
        'v4-postcss',
        false,
      );
      learner.record(
        'tailwind',
        `tailwindcss@3.${String(round)}.0`,
        V3_FEATURES,
        'legacy-content',
        true,
      );
      learner.record(
        'tailwind',
        `tailwindcss@4.${String(round)}.0`,
        V4_FEATURES,
        'v4-postcss',
        true,
      );
      learner.record(
        'tailwind',
        `tailwindcss@4.${String(round)}.0`,
        V4_FEATURES,
        'legacy-content',
        false,
      );
    }

    expect(
      learner.rank('tailwind', 'tailwindcss@5.0.0', UNSEEN_V5_FEATURES, [
        'legacy-content',
        'v4-postcss',
      ]),
    ).toEqual(['v4-postcss', 'legacy-content']);
    expect(learner.score('tailwind', 'v4-postcss', UNSEEN_V5_FEATURES)).toBeGreaterThan(0.5);
    expect(learner.score('tailwind', 'legacy-content', UNSEEN_V5_FEATURES)).toBeLessThan(0.5);
  });

  /** Outcomes and weights survive a new process; corrupted files start neutral. */
  it('persists evidence and ignores unreadable stores', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'react-preview-adapter-learning-'));
    temporaryRoots.push(root);
    const storePath = path.join(root, 'adapter-strategies.json');
    new PreviewAdapterStrategyLearner({ storePath }).record(
      'tailwind',
      'tailwindcss@4.1.0',
      V4_FEATURES,
      'v4-postcss',
      true,
    );

    const reloaded = new PreviewAdapterStrategyLearner({ storePath });
    expect(reloaded.readOutcome('tailwind', 'tailwindcss@4.1.0', 'v4-postcss')).toBe(true);
    expect(reloaded.score('tailwind', 'v4-postcss', V4_FEATURES)).toBeGreaterThan(0.5);

    await writeFile(storePath, '{"schema":1,"outcomes":', 'utf8');
    const neutral = new PreviewAdapterStrategyLearner({ storePath });
    expect(neutral.readOutcome('tailwind', 'tailwindcss@4.1.0', 'v4-postcss')).toBeUndefined();
    neutral.record('tailwind', 'tailwindcss@3.4.0', V3_FEATURES, 'legacy-content', true);
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toMatchObject({ schema: 1 });
  });
});
