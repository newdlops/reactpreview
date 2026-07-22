/** Verifies the fixed-capacity FIFO gate used around allocation-heavy source transformation. */
import { describe, expect, it, vi } from 'vitest';
import { createPreviewBoundedWorkGate } from '../../../src/adapters/esbuild/previewBoundedWorkGate';

describe('createPreviewBoundedWorkGate', () => {
  /** Queued work starts in order and never exceeds the configured number of active operations. */
  it('bounds concurrent work and hands released slots to FIFO waiters', async () => {
    const gate = createPreviewBoundedWorkGate(2);
    const releases: (() => void)[] = [];
    const starts: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const operations = [0, 1, 2, 3].map((index) =>
      gate.run(async () => {
        starts.push(index);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => {
          releases[index] = resolve;
        });
        active -= 1;
      }),
    );
    await Promise.resolve();

    expect(starts).toEqual([0, 1]);
    expect(maximumActive).toBe(2);
    releases[0]?.();
    await vi.waitFor(() => {
      expect(starts).toEqual([0, 1, 2]);
    });
    releases[1]?.();
    await vi.waitFor(() => {
      expect(starts).toEqual([0, 1, 2, 3]);
    });
    releases[2]?.();
    releases[3]?.();
    await Promise.all(operations);
    expect(maximumActive).toBe(2);
  });

  /** A rejected operation releases its slot so later source transforms cannot deadlock. */
  it('continues after a rejected operation', async () => {
    const gate = createPreviewBoundedWorkGate(1);
    const failed = gate.run(() => Promise.reject(new Error('bad transform')));
    const recovered = gate.run(() => Promise.resolve('ok'));

    await expect(failed).rejects.toThrow('bad transform');
    await expect(recovered).resolves.toBe('ok');
  });

  /** Invalid capacity fails before a plugin can enqueue work under an unusable policy. */
  it('rejects invalid concurrency limits', () => {
    expect(() => createPreviewBoundedWorkGate(0)).toThrow(RangeError);
    expect(() => createPreviewBoundedWorkGate(1.5)).toThrow(RangeError);
  });
});
