/** Verifies lexical memo invalidation and live alias membership without filesystem assumptions. */
import { describe, expect, it } from 'vitest';
import {
  createPreviewParentSliceTargetImportMatcher,
  matchesPreviewParentSliceTargetImport,
} from '../../../../src/adapters/esbuild/parentSlice/previewParentSliceImports';

const CONSUMER = '/workspace/src/Owner.tsx';
const TARGET = '/workspace/src/Target.tsx';

describe('request-local parent-slice import matcher', () => {
  /** Accepted aliases are mutable caller state and must be checked even after a lexical cache hit. */
  it('observes additions, removals, replacement sets, and accepted-result short circuits', () => {
    const match = createPreviewParentSliceTargetImportMatcher();
    const accepted = new Set<string>();
    expect(match('@project/row?raw', CONSUMER, TARGET, accepted)).toBe(false);
    accepted.add('@project/row');
    expect(match('@project/row?raw', CONSUMER, TARGET, accepted)).toBe(true);
    accepted.clear();
    expect(match('@project/row?raw', CONSUMER, TARGET, accepted)).toBe(false);
    expect(match('@project/row', CONSUMER, TARGET, new Set(['@project/row']))).toBe(true);
    expect(match('@project/row', CONSUMER, TARGET, accepted)).toBe(false);
    accepted.add('unrelated');
    expect(match('unrelated', CONSUMER, '/different/Target.tsx', accepted)).toBe(true);
    accepted.clear();
    expect(match('unrelated', CONSUMER, '/different/Target.tsx', accepted)).toBe(false);
  });

  /** Each key belongs to the current call, including when only the owning directory changes. */
  it('invalidates relative comparisons on consumer, target, and specifier changes', () => {
    const match = createPreviewParentSliceTargetImportMatcher();
    const accepted = new Set<string>();
    expect(match('./Target', CONSUMER, TARGET, accepted)).toBe(true);
    expect(match('./Target', '/other/Owner.tsx', TARGET, accepted)).toBe(false);
    expect(match('./Target', '/other/Owner.tsx', '/other/Target/index.tsx', accepted)).toBe(true);
    expect(match('./Other', '/other/Owner.tsx', '/other/Target/index.tsx', accepted)).toBe(false);
    expect(match('./Target#hash', CONSUMER, TARGET, accepted)).toBe(true);
    expect(match('?query', CONSUMER, TARGET, new Set(['']))).toBe(false);
    expect(match('./Target', CONSUMER, TARGET, accepted)).toBe(true);
  });

  /** The same sequential fixture also exercises single-entry eviction and new request isolation. */
  it('preserves the uncached rules across extension, separator, suffix, and case boundaries', () => {
    const match = createPreviewParentSliceTargetImportMatcher();
    const accepted = new Set<string>();
    const specifiers = [
      './Target',
      './Target.tsx',
      './Target/index',
      './target',
      './Target?raw',
      '.\\Target#hash',
      '/workspace/src/Target.tsx',
      '@/src/Target',
      '~/src/Target',
      'src/Target',
      'Target',
      'Target.tsx',
      '',
      '#hash',
    ];
    for (const target of [TARGET, '/workspace/src/Target/index.tsx', '/other/Target.tsx', TARGET]) {
      for (const specifier of specifiers) {
        const expected = matchesPreviewParentSliceTargetImport(
          specifier,
          CONSUMER,
          target,
          accepted,
        );
        expect(match(specifier, CONSUMER, target, accepted)).toBe(expected);
        expect(match(specifier, CONSUMER, target, accepted)).toBe(expected);
      }
    }
    accepted.add('project-alias');
    expect(match('project-alias', CONSUMER, TARGET, accepted)).toBe(true);
    expect(
      createPreviewParentSliceTargetImportMatcher()('project-alias', CONSUMER, TARGET, new Set()),
    ).toBe(false);
  });
});
