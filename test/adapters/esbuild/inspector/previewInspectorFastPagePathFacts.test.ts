/** Preserve candidate identity, ordering, containment, and bounded path-arithmetic work. */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  selectPreviewInspectorFastPageConsumerPaths,
  selectPreviewInspectorFastReverseProbePaths,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorFastPageCandidates';

afterEach(() => vi.restoreAllMocks());
const projectRoot = path.resolve('/workspace/application');
const documentPath = path.join(projectRoot, 'src/common/Button.tsx');
const selectors = [
  ['page consumers', selectPreviewInspectorFastPageConsumerPaths],
  ['reverse probes', selectPreviewInspectorFastReverseProbePaths],
] as const;

describe('fast candidate path arithmetic', () => {
  it.each(selectors)('computes each source relative path at most once for %s', (name, select) => {
    const sourcePaths = Object.freeze(
      Array.from({ length: 240 }, (_, index) =>
        path.join(
          projectRoot,
          'src',
          `feature-${String(index)}`,
          'screens',
          `page-${String(index)}.tsx`,
        ),
      ),
    );
    const relative = vi.spyOn(path, 'relative');
    const selected = select(sourcePaths, projectRoot, documentPath);
    expect(selected).toHaveLength(sourcePaths.length);
    expect(Object.isFrozen(selected)).toBe(true);
    for (const sourcePath of sourcePaths) {
      expect(
        relative.mock.calls.filter(([from, to]) => from === projectRoot && to === sourcePath)
          .length,
        name + ' relative reads for ' + sourcePath,
      ).toBeLessThanOrEqual(1);
    }
  });

  it.each(selectors)(
    'keeps sibling prefixes, escaped paths, and tooling outside %s',
    (_name, select) => {
      const allowed = path.join(projectRoot, 'src/feature/Page.tsx');
      const selected = select(
        [
          path.join(projectRoot + '-other', 'src/pages/Outside.tsx'),
          path.join(projectRoot, '..', 'outside', 'src/pages/Outside.tsx'),
          path.join(projectRoot, 'src/__tests__/HiddenPage.tsx'),
          path.join(projectRoot, 'src/feature/Page.stories.tsx'),
          path.join(projectRoot, 'src/feature/Page.spec.tsx'),
          path.join(projectRoot, 'src/feature/readme.md'),
          allowed,
        ],
        projectRoot,
        documentPath,
      );
      expect(selected).toEqual([allowed]);
    },
  );

  it('preserves authored page paths and normalized duplicate reverse identities', () => {
    const canonical = path.join(projectRoot, 'src/feature/Page.tsx');
    const authored =
      projectRoot + path.sep + ['src', 'folder', '..', 'feature', 'Page.tsx'].join(path.sep);
    const sources = [authored, canonical];
    expect(selectPreviewInspectorFastPageConsumerPaths(sources, projectRoot, documentPath)).toEqual(
      [canonical, authored],
    );
    expect(selectPreviewInspectorFastReverseProbePaths(sources, projectRoot, documentPath)).toEqual(
      [canonical, canonical],
    );
    expect(sources).toEqual([authored, canonical]);
  });

  it.each(selectors)(
    'rechecks containment when the next %s selection has a different root',
    (_name, select) => {
      const inside = path.join(projectRoot, 'src/feature/Page.tsx');
      const sibling = path.join(projectRoot, 'src/feature-two/Page.tsx');
      const sources = [inside, sibling];
      expect(select(sources, projectRoot, documentPath)).toHaveLength(2);
      expect(select(sources, path.join(projectRoot, 'src/feature'), documentPath)).toEqual([
        inside,
      ]);
    },
  );
});
