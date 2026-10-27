/** Verifies monotonic initial-document progress across fast-to-full fallback work. */
import { describe, expect, it } from 'vitest';
import { PreviewProgressGate } from '../../src/presentation/previewProgressGate';

describe('PreviewProgressGate', () => {
  it('retains total and stage times through duplicate reports, skipped stages and completion', () => {
    let now = 100;
    const gate = new PreviewProgressGate(() => now);
    gate.accept(1, 'resolving-target');
    now = 350;
    expect(gate.isCurrent(1, 'resolving-target')).toBe(true);
    gate.accept(1, 'resolving-target');
    now = 1000;
    gate.accept(1, 'discovering-components');
    now = 1500;
    expect(gate.snapshot(1)).toEqual({
      elapsedMs: 1400,
      stages: [
        { stage: 'resolving-target', elapsedMs: 900 },
        { stage: 'discovering-components', elapsedMs: 500 },
      ],
    });
    now = 2100;
    gate.accept(1, 'ready');
    now = 10000;
    expect(gate.snapshot(1)).toEqual({
      elapsedMs: 2000,
      stages: [
        { stage: 'resolving-target', elapsedMs: 900 },
        { stage: 'discovering-components', elapsedMs: 1100 },
      ],
    });
  });

  it('resets timing for a new revision while old snapshots and stale reports remain isolated', () => {
    let now = 10;
    const gate = new PreviewProgressGate(() => now);
    gate.accept(1, 'preparing-runtime');
    now = 1010;
    const before = gate.snapshot(1);
    gate.accept(2, 'resolving-target');
    now = 1260;
    expect(gate.accept(1, 'ready')).toBe(false);
    expect(gate.snapshot(1)).toBeUndefined();
    expect(gate.snapshot(2)).toEqual({
      elapsedMs: 250,
      stages: [{ stage: 'resolving-target', elapsedMs: 250 }],
    });
    expect(before).toEqual({
      elapsedMs: 1000,
      stages: [{ stage: 'preparing-runtime', elapsedMs: 1000 }],
    });
  });

  /** Rejects a restarted earlier stage without preventing later completion in the same revision. */
  it('keeps one revision monotonic', () => {
    const gate = new PreviewProgressGate();

    expect(gate.accept(3, 'bundling-modules')).toBe(true);
    expect(gate.accept(3, 'analyzing-project')).toBe(false);
    expect(gate.accept(3, 'publishing-artifacts')).toBe(true);
    expect(gate.accept(3, 'ready')).toBe(true);
    expect(gate.accept(3, 'loading-preview')).toBe(false);
  });

  /** Lets a newer edit start again at target resolution while ignoring stale older messages. */
  it('resets only for a newer revision', () => {
    const gate = new PreviewProgressGate();

    expect(gate.accept(4, 'ready')).toBe(true);
    expect(gate.accept(5, 'resolving-target')).toBe(true);
    expect(gate.accept(4, 'ready')).toBe(false);
  });
});
