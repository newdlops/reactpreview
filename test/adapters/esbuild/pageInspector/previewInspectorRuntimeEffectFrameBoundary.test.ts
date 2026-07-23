/**
 * Verifies that render-only effect protection distinguishes a browser-paced animation from a
 * synchronous React update loop. The generated runtime remains isolated from a project React
 * package; deterministic frame queues model only the scheduler boundary relevant to the limiter.
 */
import { describe, expect, it } from 'vitest';
import { PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackRuntimeSource';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

/** Stable compiler metadata representing one state-driven authored animation effect. */
function createAnimationEffectMetadata(): object {
  return {
    ...createMetadata(),
    hookName: 'useEffect',
    id: 'animation-effect',
    requiredPaths: [],
  };
}

describe('Preview Inspector runtime effect frame boundary', () => {
  /**
   * A dependency-driven effect can legitimately execute once after every animation-frame state
   * update. Its total frequency must not be mistaken for an infinite synchronous render loop.
   */
  it('keeps a repeated effect active across arbitrarily many painted frames', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = createAnimationEffectMetadata();
    const frameCount = PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT * 4;
    let executions = 0;

    for (let frame = 0; frame < frameCount; frame += 1) {
      fixture.api.effect(() => {
        executions += 1;
      }, metadata);
      fixture.flushEffectFrame();
    }

    expect(executions).toBe(frameCount);
    expect(fixture.consoleEntries).toEqual([]);
    expect(fixture.warnings).toEqual([]);
  });

  /**
   * Webviews normally provide requestAnimationFrame, but the generated runtime also runs in
   * hardened/test browsers. Its bounded timer boundary must preserve the same animation semantics.
   */
  it('uses the timer fallback when requestAnimationFrame is unavailable', () => {
    const fixture = createRuntimeFallbackFixture(true, { animationFrameSupported: false });
    const metadata = createAnimationEffectMetadata();
    const frameCount = PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT * 2;
    let executions = 0;

    for (let frame = 0; frame < frameCount; frame += 1) {
      fixture.api.effect(() => {
        executions += 1;
      }, metadata);
      fixture.flushEffectFrame();
    }

    expect(executions).toBe(frameCount);
    expect(fixture.warnings).toEqual([]);
  });

  /** The safety boundary still cuts an effect/update burst that cannot yield to one paint. */
  it('isolates repeated executions within one browser frame', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = createAnimationEffectMetadata();
    let executions = 0;

    for (let index = 0; index < PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT + 3; index += 1) {
      fixture.api.effect(() => {
        executions += 1;
      }, metadata);
    }

    expect(executions).toBe(PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT);
    expect(fixture.warnings[0]).toContain('before the next browser frame');
  });

  /** Revision changes invalidate a previous burst even before its old frame callback is delivered. */
  it('starts a fresh frame budget for a new hot revision', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = createAnimationEffectMetadata();
    let executions = 0;

    for (let index = 0; index < PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT; index += 1) {
      fixture.api.effect(() => {
        executions += 1;
      }, metadata);
    }
    fixture.api.setRevision(1);
    fixture.api.effect(() => {
      executions += 1;
    }, metadata);

    expect(executions).toBe(PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT + 1);
  });
});
