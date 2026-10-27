/** Protects request-local lexical reuse without memoizing live project-resolution decisions. */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzePreviewParentSlices } from '../../../../src/adapters/esbuild/parentSlice';

const CONSUMER_PATH = '/workspace/application/src/OwnerPage.tsx';
const TARGET_PATH = '/workspace/application/src/TargetRow.tsx';

afterEach(() => vi.restoreAllMocks());

describe('parent-slice import matching', () => {
  /** A named-import group shares its pure path comparison while preserving distinct JSX usages. */
  it('normalizes one target and one relative module for a large named-import group', () => {
    const names = Array.from({ length: 48 }, (_, index) => `Row${String(index)}`);
    const normalize = vi.spyOn(path, 'normalize');
    const analysis = analyzePreviewParentSlices({
      consumerPath: CONSUMER_PATH,
      sourceText: [
        `import { ${names.map((name) => `TargetRow as ${name}`).join(', ')} } from './TargetRow';`,
        'export const OwnerPage = () => <main><Row0 count={2} /><Row47 count={3} /></main>;',
      ].join('\n'),
      targetExportNames: ['TargetRow'],
      targetPath: TARGET_PATH,
    });

    expect(analysis.slices.map((slice) => slice.targetLocalName)).toEqual(['Row0', 'Row47']);
    expect(analysis.slices.map((slice) => slice.targetProps)).toEqual([{ count: 2 }, { count: 3 }]);
    expect(analysis.slices.every((slice) => slice.owner?.localName === 'OwnerPage')).toBe(true);
    expect(normalize.mock.calls.filter(([sourcePath]) => sourcePath === TARGET_PATH)).toHaveLength(
      1,
    );
    expect(
      normalize.mock.calls.filter(([sourcePath]) => sourcePath === TARGET_PATH.slice(0, -4)),
    ).toHaveLength(1);
  });

  /** Negative lexical reuse cannot freeze the result of a mutable, caller-owned resolver. */
  it('calls the live resolver for every unmatched binding and every new analysis', () => {
    let acceptedName = 'Row0';
    const resolver = vi.fn(() => {
      const accepted = acceptedName === 'Row0';
      acceptedName = accepted ? 'Row1' : 'Row0';
      return accepted;
    });
    const options = {
      consumerPath: CONSUMER_PATH,
      matchesTargetImport: resolver,
      sourceText: [
        "import { TargetRow as Row0, TargetRow as Row1, TargetRow as Row2 } from '@project/alias';",
        'export const OwnerPage = () => <main><Row0 /><Row1 /><Row2 /></main>;',
      ].join('\n'),
      targetExportNames: ['TargetRow'],
      targetPath: TARGET_PATH,
    };

    expect(
      analyzePreviewParentSlices(options).slices.map((slice) => slice.targetLocalName),
    ).toEqual(['Row0', 'Row2']);
    expect(
      analyzePreviewParentSlices(options).slices.map((slice) => slice.targetLocalName),
    ).toEqual(['Row1']);
    expect(resolver).toHaveBeenCalledTimes(6);
    expect(resolver).toHaveBeenNthCalledWith(6, '@project/alias', CONSUMER_PATH, TARGET_PATH);
  });
});
