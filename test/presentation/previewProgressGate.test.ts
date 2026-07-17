/** Verifies monotonic initial-document progress across fast-to-full fallback work. */
import { describe, expect, it } from 'vitest';
import { PreviewProgressGate } from '../../src/presentation/previewProgressGate';

describe('PreviewProgressGate', () => {
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
