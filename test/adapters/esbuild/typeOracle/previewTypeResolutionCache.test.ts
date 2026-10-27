/** Per-program answers must stay bounded while new programs always read fresh module inputs. */
import type ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { PreviewTypeResolutionCache } from '../../../../src/adapters/esbuild/typeOracle/previewTypeResolutionCache';

describe('PreviewTypeResolutionCache', () => {
  it('shares answers inside one program and forgets both hits and misses for the next', () => {
    const cache = new PreviewTypeResolutionCache();
    const files = new Set(['/entry.ts']);
    const reader = createHost(files);
    const first = cache.createHost(reader);
    expect(first.fileExists('/entry.ts')).toBe(true);
    expect(first.fileExists('/missing.ts')).toBe(false);
    cache.write('present', '/entry.ts');
    cache.write('missing', undefined);
    expect(cache.read('present')).toBe('/entry.ts');
    expect(cache.read('missing')).toBeNull();
    files.add('/missing.ts');
    const next = cache.createHost(reader);
    expect(cache.read('present')).toBeUndefined();
    expect(cache.read('missing')).toBeUndefined();
    expect(next.fileExists('/missing.ts')).toBe(true);
  });

  it('does not let an older host populate the current program answers', () => {
    const cache = new PreviewTypeResolutionCache();
    const old = cache.createHost(createHost(new Set()));
    const current = cache.createHost(createHost(new Set(['/entry.ts'])));
    expect(current.fileExists('/entry.ts')).toBe(true);
    cache.write('answer', '/entry.ts');
    expect(old.fileExists('/entry.ts')).toBe(false);
    expect(cache.read('answer')).toBe('/entry.ts');
  });

  it('does no eager filesystem replay and preserves transient lookup failures', () => {
    const cache = new PreviewTypeResolutionCache();
    const lookup = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('transient');
      })
      .mockReturnValue(true);
    const next = cache.createHost({ ...createHost(new Set()), fileExists: lookup });
    expect(lookup).not.toHaveBeenCalled();
    expect(() => next.fileExists('/entry.ts')).toThrow('transient');
    expect(next.fileExists('/entry.ts')).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('keeps ordinary source reads live instead of sharing their previous text', () => {
    const cache = new PreviewTypeResolutionCache();
    let text = 'first source';
    const readFile = vi.fn(() => text);
    const host = cache.createHost({ ...createHost(new Set()), readFile });
    expect(host.readFile('/entry.ts')).toBe('first source');
    text = 'edited source';
    expect(host.readFile('/entry.ts')).toBe('edited source');
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it('returns complete oversized metadata without retaining it beyond the read budget', () => {
    const cache = new PreviewTypeResolutionCache();
    const text = 'x'.repeat(512 * 1024);
    const readFile = vi.fn(() => text);
    const host = cache.createHost({ ...createHost(new Set()), readFile });
    expect(host.readFile('/package.json')).toBe(text);
    expect(host.readFile('/package.json')).toBe(text);
    expect(readFile).toHaveBeenCalledTimes(2);
    cache.write('answer', '/entry.ts');
    expect(cache.read('answer')).toBe('/entry.ts');
    cache.createHost(createHost(new Set()));
    expect(cache.read('answer')).toBeUndefined();
  });

  it('keeps normal lookup and existing answers available after the answer storage limit', () => {
    const cache = new PreviewTypeResolutionCache();
    const host = cache.createHost(createHost(new Set(['/extra.ts'])));
    for (let index = 0; index < 50_000; index += 1) cache.write(String(index), '/entry.ts');
    cache.write('extra', '/extra.ts');
    expect(cache.read('extra')).toBeUndefined();
    expect(host.fileExists('/extra.ts')).toBe(true);
    cache.write('0', '/updated.ts');
    expect(cache.read('0')).toBe('/updated.ts');
  });

  it('keeps old program metadata isolated while clear releases its reusable answers', () => {
    const cache = new PreviewTypeResolutionCache();
    const old = cache.createHost({ ...createHost(new Set()), readFile: () => 'old package' });
    expect(old.readFile('/package.json')).toBe('old package');
    cache.write('answer', '/old.ts');
    cache.clear();
    expect(cache.read('answer')).toBeUndefined();
    const current = cache.createHost({ ...createHost(new Set()), readFile: () => 'new package' });
    expect(current.readFile('/package.json')).toBe('new package');
    cache.write('answer', '/new.ts');
    expect(old.readFile('/package.json')).toBe('old package');
    expect(current.readFile('/package.json')).toBe('new package');
    expect(cache.read('answer')).toBe('/new.ts');
  });
});

/** A small host checks storage lifetime; separate real-program suites verify actual type freshness. */
function createHost(files: ReadonlySet<string>): ts.ModuleResolutionHost {
  return { fileExists: (file) => files.has(file), readFile: () => undefined };
}
