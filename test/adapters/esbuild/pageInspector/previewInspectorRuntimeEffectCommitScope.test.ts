/** Real commit ownership must admit siblings while keeping execution fallback and loop protection. */
import { describe, expect, it } from 'vitest';
import { PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT as LIMIT } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackRuntimeSource';
import {
  createMetadata,
  createRuntimeFallbackFixture,
  type RuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

/** Installs an owned clock in the generated runtime's realm, returning its opaque context token. */
function seedClock(
  fixture: RuntimeFallbackFixture,
  serial = 1,
  initialCommitCompleted = true,
): unknown {
  return fixture.evaluate(`(() => {
    const token = Object.freeze({});
    previewInspectorSession.runtimeEffectCommitClock = {token, revision:0, serial:${String(serial)}, initialCommitCompleted:${String(initialCommitCompleted)}};
    return token;
  })()`);
}

describe('effect commit ownership', () => {
  const metadata = { ...createMetadata(), id: 'shared-effect', hookName: 'useEffect' };

  it('executes all siblings in one observed commit without isolating their shared source site', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const token = seedClock(fixture);
    let executed = 0;
    for (let index = 0; index < 40; index += 1)
      fixture.api.effect(
        () => {
          executed += 1;
        },
        metadata,
        undefined,
        token,
      );
    expect(executed).toBe(40);
    expect(fixture.warnings).toEqual([]);
  });

  it('retains the 24-commit protection for synchronous update, remount and growth waves', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const token = seedClock(fixture);
    let executed = 0;
    for (let serial = 1; serial <= LIMIT + 3; serial += 1) {
      fixture.evaluate(
        `previewInspectorSession.runtimeEffectCommitClock.serial = ${String(serial)}`,
      );
      fixture.api.effect(
        () => {
          executed += 1;
        },
        metadata,
        undefined,
        token,
      );
    }
    expect(executed).toBe(LIMIT);
    expect(fixture.warnings).toHaveLength(1);
  });

  it('admits the first layout batch but falls back if no Profiler commit confirms it', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const token = seedClock(fixture, 0, false);
    let initial = 0;
    for (let index = 0; index < 40; index += 1)
      fixture.api.effect(
        () => {
          initial += 1;
        },
        metadata,
        undefined,
        token,
      );
    expect(initial).toBe(40);
    fixture.evaluate(
      'previewInspectorSession.runtimeEffectCommitClock.initialCommitCompleted = true',
    );
    let later = 0;
    for (let index = 0; index < 40; index += 1)
      fixture.api.effect(
        () => {
          later += 1;
        },
        metadata,
        undefined,
        token,
      );
    expect(later).toBe(LIMIT - 1);
    expect(fixture.warnings).toHaveLength(1);
  });

  it.each(['other-root', 'retired-root', 'retired-revision'] as const)(
    'keeps ordinary execution protection for %s',
    (kind) => {
      const fixture = createRuntimeFallbackFixture(true);
      let token = seedClock(fixture);
      if (kind === 'other-root') token = {};
      if (kind === 'retired-root') seedClock(fixture);
      if (kind === 'retired-revision') fixture.api.setRevision(1);
      let executed = 0;
      for (let index = 0; index < 40; index += 1)
        fixture.api.effect(
          () => {
            executed += 1;
          },
          metadata,
          undefined,
          token,
        );
      expect(executed).toBe(LIMIT);
      expect(fixture.warnings).toHaveLength(1);
    },
  );

  it('does not discount recursively re-entered callbacks at the same site', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const token = seedClock(fixture);
    let executed = 0;
    const recurse = (): void => {
      fixture.api.effect(
        () => {
          executed += 1;
          recurse();
        },
        metadata,
        undefined,
        token,
      );
    };
    recurse();
    expect(executed).toBe(LIMIT);
    expect(fixture.warnings).toHaveLength(1);
  });

  it('admits successive animation frames while retaining the per-frame commit boundary', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const token = seedClock(fixture);
    let executed = 0;
    for (let frame = 0; frame < 3; frame += 1) {
      for (let commit = 1; commit <= LIMIT; commit += 1) {
        fixture.evaluate(
          `previewInspectorSession.runtimeEffectCommitClock.serial = ${String(frame * LIMIT + commit)}`,
        );
        for (let sibling = 0; sibling < 3; sibling += 1) {
          fixture.api.effect(
            () => {
              executed += 1;
            },
            metadata,
            undefined,
            token,
          );
        }
      }
      fixture.flushEffectFrame();
    }
    expect(executed).toBe(3 * LIMIT * 3);
    expect(fixture.warnings).toEqual([]);
  });

  it('bounds mutual synchronous reentry across different effect source sites', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const token = seedClock(fixture);
    const otherMetadata = { ...metadata, id: 'other-effect' };
    let left = 0;
    let right = 0;
    const runLeft = (): void => {
      fixture.api.effect(
        () => {
          left += 1;
          // Keep a broken guard's negative test bounded without depending on a stack overflow.
          if (left > LIMIT + 1) throw new Error('Unbounded mutual reentry');
          runRight();
        },
        metadata,
        undefined,
        token,
      );
    };
    const runRight = (): void => {
      fixture.api.effect(
        () => {
          right += 1;
          runLeft();
        },
        otherMetadata,
        undefined,
        token,
      );
    };
    runLeft();
    expect([left, right]).toEqual([LIMIT, LIMIT]);
    expect(fixture.warnings).toHaveLength(1);
    expect(fixture.warnings[0]).toContain('repeated effect execution');
  });
});
