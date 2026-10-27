/** Verifies bounded exact-source reuse of real syntax-proven hook projection evidence. */
import { describe, expect, it, vi } from 'vitest';
import * as inventory from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInventory';
import { collectPreviewRuntimeHookProjectionEvidence } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

const SOURCE =
  'import { useData } from "./hooks"; export function Page() { const data = useData(); return <p>{data.name}</p>; }';
const EXPECTED = [{ localName: 'useData', occurrenceStart: SOURCE.indexOf('useData()') }];

describe('hook projection evidence memo', () => {
  it('computes unchanged evidence once across repeated preparation passes', () => {
    const inspect = vi.spyOn(inventory, 'collectRuntimeHookInventory');
    for (let index = 0; index < 20; index += 1) {
      expect(
        collectPreviewRuntimeHookProjectionEvidence('/projection/repeated.tsx', SOURCE),
      ).toEqual(EXPECTED);
    }
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('recomputes edited and restored source while preserving direct call offsets', () => {
    const inspect = vi.spyOn(inventory, 'collectRuntimeHookInventory');
    const sourcePath = '/projection/edited.tsx';
    const changed = SOURCE.replaceAll('useData', 'useNext').replaceAll('data', 'next');
    expect(collectPreviewRuntimeHookProjectionEvidence(sourcePath, SOURCE)).toEqual(EXPECTED);
    expect(collectPreviewRuntimeHookProjectionEvidence(sourcePath, changed)).toEqual([
      { localName: 'useNext', occurrenceStart: changed.indexOf('useNext()') },
    ]);
    expect(collectPreviewRuntimeHookProjectionEvidence(sourcePath, SOURCE)).toEqual(EXPECTED);
    expect(inspect).toHaveBeenCalledTimes(3);
  });

  it('keeps source grammars and exact paths separate', () => {
    expect(collectPreviewRuntimeHookProjectionEvidence('/projection/grammar.tsx', SOURCE)).toEqual(
      EXPECTED,
    );
    expect(collectPreviewRuntimeHookProjectionEvidence('/projection/grammar.ts', SOURCE)).toEqual(
      [],
    );
    expect(collectPreviewRuntimeHookProjectionEvidence('/projection/grammar.jsx', SOURCE)).toEqual(
      EXPECTED,
    );
  });

  it('does not retain empty proof results', () => {
    const inspect = vi.spyOn(inventory, 'collectRuntimeHookInventory');
    const source = SOURCE.replaceAll('useData', 'useLazyQuery');
    for (let index = 0; index < 2; index += 1)
      expect(collectPreviewRuntimeHookProjectionEvidence('/projection/lazy.tsx', source)).toEqual(
        [],
      );
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it('invalidates prior evidence when an edit no longer contains a hook', () => {
    const inspect = vi.spyOn(inventory, 'collectRuntimeHookInventory');
    const sourcePath = '/projection/removed.tsx';
    expect(collectPreviewRuntimeHookProjectionEvidence(sourcePath, SOURCE)).toEqual(EXPECTED);
    expect(
      collectPreviewRuntimeHookProjectionEvidence(sourcePath, 'export const Page = () => <p />;'),
    ).toEqual([]);
    expect(collectPreviewRuntimeHookProjectionEvidence(sourcePath, SOURCE)).toEqual(EXPECTED);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it('bounds retained entries and recomputes an evicted source', () => {
    const inspect = vi.spyOn(inventory, 'collectRuntimeHookInventory');
    const sourcePath = '/projection/oldest.tsx';
    expect(collectPreviewRuntimeHookProjectionEvidence(sourcePath, SOURCE)).toEqual(EXPECTED);
    for (let index = 0; index < 512; index += 1)
      expect(
        collectPreviewRuntimeHookProjectionEvidence(
          `/projection/entry-${String(index)}.tsx`,
          SOURCE,
        ),
      ).toEqual(EXPECTED);
    expect(collectPreviewRuntimeHookProjectionEvidence(sourcePath, SOURCE)).toEqual(EXPECTED);
    expect(inspect).toHaveBeenCalledTimes(514);
  });

  it('keeps a recently reused source when older entries are evicted', () => {
    const inspect = vi.spyOn(inventory, 'collectRuntimeHookInventory');
    const sourcePath = '/projection/recent.tsx';
    expect(collectPreviewRuntimeHookProjectionEvidence(sourcePath, SOURCE)).toEqual(EXPECTED);
    for (let index = 0; index < 511; index += 1)
      collectPreviewRuntimeHookProjectionEvidence(
        `/projection/recent-${String(index)}.tsx`,
        SOURCE,
      );
    expect(collectPreviewRuntimeHookProjectionEvidence(sourcePath, SOURCE)).toEqual(EXPECTED);
    collectPreviewRuntimeHookProjectionEvidence('/projection/overflow.tsx', SOURCE);
    expect(collectPreviewRuntimeHookProjectionEvidence(sourcePath, SOURCE)).toEqual(EXPECTED);
    collectPreviewRuntimeHookProjectionEvidence('/projection/recent-0.tsx', SOURCE);
    expect(inspect).toHaveBeenCalledTimes(514);
  });

  it('bounds retained source payload independently of the entry count', () => {
    const inspect = vi.spyOn(inventory, 'collectRuntimeHookInventory');
    const source = SOURCE + '/*' + 'x'.repeat(50 * 1024) + '*/';
    for (let index = 0; index < 42; index += 1)
      expect(
        collectPreviewRuntimeHookProjectionEvidence(
          `/projection/bytes-${String(index)}.tsx`,
          source,
        ),
      ).toEqual(EXPECTED);
    expect(collectPreviewRuntimeHookProjectionEvidence('/projection/bytes-0.tsx', source)).toEqual(
      EXPECTED,
    );
    expect(inspect).toHaveBeenCalledTimes(43);
  });

  it('does not retain a single source over the per-module limit', () => {
    const inspect = vi.spyOn(inventory, 'collectRuntimeHookInventory');
    const source = SOURCE + '/*' + 'x'.repeat(64 * 1024) + '*/';
    for (let index = 0; index < 2; index += 1)
      expect(
        collectPreviewRuntimeHookProjectionEvidence('/projection/oversized.tsx', source),
      ).toEqual(EXPECTED);
    expect(inspect).toHaveBeenCalledTimes(2);
  });
});
