/**
 * Verifies structured stage timing independently from VS Code panel and webview behavior.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PreviewStageDurationTrace } from '../../src/domain/previewBuildExecution';
import { PreviewPerformanceTrace } from '../../src/presentation/previewPerformanceTrace';

describe('PreviewPerformanceTrace', () => {
  /** Records monotonic stage durations and treats ready as a terminal steady state. */
  it('reports each completed preparation interval with revision and target context', () => {
    const traces: PreviewStageDurationTrace[] = [];
    const now = vi
      .fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(35)
      .mockReturnValueOnce(40)
      .mockReturnValueOnce(45);
    const recorder = new PreviewPerformanceTrace((trace) => traces.push(trace), now);

    recorder.transition(4, 'src/Target.tsx', 'resolving-target');
    recorder.transition(4, 'src/Target.tsx', 'analyzing-project');
    recorder.transition(4, 'src/Target.tsx', 'ready');

    expect(traces).toEqual([
      {
        durationMs: 25,
        outcome: 'completed',
        revision: 4,
        stage: 'resolving-target',
        target: 'src/Target.tsx',
      },
      {
        durationMs: 5,
        outcome: 'completed',
        revision: 4,
        stage: 'analyzing-project',
        target: 'src/Target.tsx',
      },
    ]);
  });

  /** Ignores duplicate and stale events while marking superseded work as cancelled. */
  it('does not reset duplicate stages or let stale completion close a newer revision', () => {
    const traces: PreviewStageDurationTrace[] = [];
    let timestamp = 0;
    const recorder = new PreviewPerformanceTrace(
      (trace) => traces.push(trace),
      () => timestamp,
    );

    recorder.transition(1, 'src/Target.tsx', 'bundling-modules');
    timestamp = 4;
    recorder.transition(1, 'src/Target.tsx', 'bundling-modules');
    timestamp = 9;
    recorder.transition(2, 'src/Target.tsx', 'resolving-target');
    timestamp = 12;
    recorder.finish('completed', 1);
    timestamp = 15;
    recorder.finish('completed', 2);

    expect(traces).toEqual([
      expect.objectContaining({
        durationMs: 9,
        outcome: 'cancelled',
        revision: 1,
        stage: 'bundling-modules',
      }),
      expect.objectContaining({
        durationMs: 6,
        outcome: 'completed',
        revision: 2,
        stage: 'resolving-target',
      }),
    ]);
  });
});
