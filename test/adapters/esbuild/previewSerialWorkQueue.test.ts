/** Verifies package-keyed serialization used to bound concurrent Tailwind processor memory. */
import { describe, expect, it } from 'vitest';
import { runPreviewSerialWork } from '../../../src/adapters/esbuild/previewSerialWorkQueue';

describe('runPreviewSerialWork', () => {
  /** Same-key work waits, while a separate package key can proceed immediately. */
  it('serializes only operations sharing a resource key', async () => {
    const queues = new Map<string, Promise<void>>();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = runPreviewSerialWork(queues, 'package-a', async () => {
      events.push('first-start');
      await firstGate;
      events.push('first-end');
    });
    const second = runPreviewSerialWork(queues, 'package-a', () => {
      events.push('second');
      return Promise.resolve();
    });
    const parallel = runPreviewSerialWork(queues, 'package-b', () => {
      events.push('parallel');
      return Promise.resolve();
    });
    await Promise.resolve();

    expect(events).toEqual(['first-start', 'parallel']);
    releaseFirst();
    await Promise.all([first, second, parallel]);
    expect(events).toEqual(['first-start', 'parallel', 'first-end', 'second']);
    expect(queues.size).toBe(0);
  });

  /** Failed work settles the queue so a later hot rebuild can still proceed. */
  it('continues after a rejected operation', async () => {
    const queues = new Map<string, Promise<void>>();
    const failed = runPreviewSerialWork(queues, 'package', () => Promise.reject(new Error('bad')));
    const recovered = runPreviewSerialWork(queues, 'package', () => Promise.resolve('ok'));

    await expect(failed).rejects.toThrow('bad');
    await expect(recovered).resolves.toBe('ok');
    expect(queues.size).toBe(0);
  });
});
