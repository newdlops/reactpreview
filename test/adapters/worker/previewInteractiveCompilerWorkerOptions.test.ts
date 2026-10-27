/** Verify eligibility, explicit settings, frozen worker isolation, and unchanged parent state. */
import { describe, expect, it } from 'vitest';
import { createPreviewCompilerWorkerOptions } from '../../../src/adapters/worker/previewCompilerWorkerIsolation';
import { createPreviewInteractiveCompilerWorkerOptions } from '../../../src/adapters/worker/previewInteractiveCompilerWorkerOptions';
const eligible = { memoryBytes: 48 * 1024 ** 3, cpuSlots: 15 };
describe('interactive native compiler defaults', () => {
  it('changes only absent interactive memory/GC defaults, retaining two processors', () => {
    const parent = {
        PATH: '/fixture/bin',
        PORT_MANAGER_HOOK: '1',
        NODE_OPTIONS: '--require=bad',
        DYLD_INSERT_LIBRARIES: '/fixture/inject',
        HTTPS_PROXY: 'https://fixture.invalid',
      },
      before = { ...parent };
    const standard = createPreviewCompilerWorkerOptions(parent, 4096),
      actual = createPreviewInteractiveCompilerWorkerOptions(parent, 4096, eligible);
    expect(actual).toEqual({
      ...standard,
      env: { ...standard.env, GOMEMLIMIT: '640MiB', GOGC: '200' },
    });
    expect(actual.env.GOMAXPROCS).toBe('2');
    expect(actual.env.PATH).toBe(parent.PATH);
    expect(actual.env.HTTPS_PROXY).toBe(parent.HTTPS_PROXY);
    expect(actual.execArgv).toEqual([]);
    expect(actual.resourceLimits).toEqual({ maxOldGenerationSizeMb: 4096 });
    expect(actual.env.NODE_OPTIONS).toBeUndefined();
    expect(actual.env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(actual.env.PORT_MANAGER_HOOK).toBe(standard.env.PORT_MANAGER_HOOK);
    expect(Object.isFrozen(actual)).toBe(true);
    expect(parent).toEqual(before);
  });
  for (const [parent, label] of [
    [{ GOMEMLIMIT: '128MiB' }, 'stricter memory'],
    [{ GOMEMLIMIT: '512MiB' }, 'larger explicit memory'],
    [{ GOMEMLIMIT: '' }, 'empty memory'],
    [{ GOMAXPROCS: '1' }, 'stricter CPU'],
    [{ GOMAXPROCS: '8' }, 'larger explicit CPU'],
    [{ GOGC: '50' }, 'explicit GC'],
    [{ GOGC: 'off' }, 'explicit disabled GC'],
    [{ GOGC: '' }, 'empty GC'],
  ] as const)
    it('keeps complete standard options for ' + label, () => {
      expect(createPreviewInteractiveCompilerWorkerOptions(parent, 4096, eligible)).toEqual(
        createPreviewCompilerWorkerOptions(parent, 4096),
      );
    });
  for (const host of [
    { memoryBytes: 31 * 1024 ** 3, cpuSlots: 15 },
    { memoryBytes: 48 * 1024 ** 3, cpuSlots: 7 },
    { memoryBytes: NaN, cpuSlots: 15 },
    { memoryBytes: 48 * 1024 ** 3, cpuSlots: Infinity },
  ])
    it('keeps standard options for an ineligible or invalid host ' + JSON.stringify(host), () => {
      expect(createPreviewInteractiveCompilerWorkerOptions({}, 4096, host)).toEqual(
        createPreviewCompilerWorkerOptions({}, 4096),
      );
    });
  it('keeps route/inventory and other heap profiles identical', () => {
    for (const limit of [384, 2048, 4095, 8192])
      expect(createPreviewInteractiveCompilerWorkerOptions({}, limit, eligible)).toEqual(
        createPreviewCompilerWorkerOptions({}, limit),
      );
  });
  it('requires every explicit Go setting to be absent and preserves unrelated diagnostic options', () => {
    const parent = { GODEBUG: 'gctrace=1,fixture-kept=1', PATH: '/fixture/bin' };
    expect(createPreviewInteractiveCompilerWorkerOptions(parent, 4096, eligible).env.GODEBUG).toBe(
      parent.GODEBUG,
    );
    expect(parent).toEqual({ GODEBUG: 'gctrace=1,fixture-kept=1', PATH: '/fixture/bin' });
  });
  it('admits the exact32GiB/eight-slot host boundary', () => {
    const options = createPreviewInteractiveCompilerWorkerOptions({}, 4096, {
      memoryBytes: 32 * 1024 ** 3,
      cpuSlots: 8,
    });
    expect(options.env.GOMEMLIMIT).toBe('640MiB');
    expect(options.env.GOGC).toBe('200');
    expect(options.env.GOMAXPROCS).toBe('2');
  });
});
