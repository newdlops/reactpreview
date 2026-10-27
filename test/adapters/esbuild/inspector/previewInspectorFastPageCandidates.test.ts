import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  selectPreviewInspectorFastPageConsumerPaths,
  selectPreviewInspectorFastReverseProbePaths,
  createPreviewInspectorFastPageCandidateIndex,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorFastPageCandidates';

describe('previewInspectorFastPageCandidates', () => {
  const projectRoot = path.resolve('/workspace/application');
  const targetPath = path.join(
    projectRoot,
    'src/legal/employment-status/employment-document-downloader.tsx',
  );
  const statusPagePath = path.join(
    projectRoot,
    'src/legal/employment-status/employment-documents-page.tsx',
  );
  const legalPagePath = path.join(projectRoot, 'src/legal/pages/employment-page.tsx');
  const remotePagePath = path.join(projectRoot, 'src/hr/pages/employment-page.tsx');
  const valueConsumerPath = path.join(
    projectRoot,
    'src/legal/employment-status/employment-document-columns.ts',
  );
  const testPath = path.join(
    projectRoot,
    'src/legal/employment-status/__tests__/employment-page.test.tsx',
  );
  const adjacentPageTestPath = path.join(
    projectRoot,
    'src/app/(builder)/careers-site/edit/page.test.tsx',
  );

  it('retains exact target-affinity ordering after scoring each page candidate once', () => {
    expect(
      selectPreviewInspectorFastPageConsumerPaths(
        [remotePagePath, targetPath, legalPagePath, statusPagePath, testPath, adjacentPageTestPath],
        projectRoot,
        targetPath,
      ),
    ).toEqual([statusPagePath, legalPagePath, remotePagePath]);
  });

  it('keeps non-JSX value consumers while excluding the target and tooling paths', () => {
    const selected = selectPreviewInspectorFastReverseProbePaths(
      [
        remotePagePath,
        testPath,
        adjacentPageTestPath,
        targetPath,
        valueConsumerPath,
        statusPagePath,
      ],
      projectRoot,
      targetPath,
    );

    expect(selected.slice(0, 2)).toEqual([valueConsumerPath, statusPagePath]);
    expect(selected).not.toContain(targetPath);
    expect(selected).not.toContain(testPath);
    expect(selected).not.toContain(adjacentPageTestPath);
  });

  it('precomputes page and reverse scores before their ordering comparators', () => {
    const source = readFileSync(
      new URL(
        '../../../../src/adapters/esbuild/inspector/previewInspectorFastPageCandidates.ts',
        import.meta.url,
      ),
      'utf8',
    );

    expect(source).toMatch(
      /\.map\(\(sourcePath\) => \(\{\s*score: scorePageConsumer\([\s\S]*?\}\)\)\s*\.sort\(/u,
    );
    expect(source).toMatch(
      /\.map\(\(sourcePath\) => \(\{\s*score: scoreReverseProbe\([\s\S]*?\}\)\)\s*\.sort\(/u,
    );
    expect(source).not.toMatch(
      /\.sort\(\s*\(left, right\) =>[^)]*score(?:PageConsumer|ReverseProbe)/u,
    );
  });

  it('preserves ordering and containment across shared-target pivots and lexical spellings', () => {
    const paths = [
      remotePagePath,
      statusPagePath,
      valueConsumerPath,
      testPath,
      adjacentPageTestPath,
      targetPath,
      legalPagePath,
      path.join(projectRoot, '../application-other/src/pages/outside.tsx'),
      path.join(projectRoot, 'src/법무/pages/요청-page.tsx'),
      ...Array.from({ length: 2200 }, (_, index) =>
        path.join(
          projectRoot,
          'src/feature-' + String(index % 23),
          'pages/page-' + String(index) + '.tsx',
        ),
      ),
    ];
    const index = createPreviewInspectorFastPageCandidateIndex(paths, projectRoot);
    for (const pivot of [targetPath, valueConsumerPath, legalPagePath, remotePagePath]) {
      expect(index.selectPageConsumers(pivot)).toEqual(
        selectPreviewInspectorFastPageConsumerPaths(paths, projectRoot, pivot),
      );
      expect(index.selectReverseProbes(pivot)).toEqual(
        selectPreviewInspectorFastReverseProbePaths(paths, projectRoot, pivot),
      );
    }
  });

  it('owns an inventory snapshot and uses newly created paths only in a new request', () => {
    const paths = [targetPath, legalPagePath];
    const first = createPreviewInspectorFastPageCandidateIndex(paths, projectRoot);
    paths.push(statusPagePath);
    expect(first.selectPageConsumers(targetPath)).toEqual([legalPagePath]);
    const next = createPreviewInspectorFastPageCandidateIndex(paths, projectRoot);
    expect(next.selectPageConsumers(targetPath)).toEqual([statusPagePath, legalPagePath]);
  });

  it('reuses target-independent admission when the reverse pivot changes', () => {
    const paths = [targetPath, valueConsumerPath, legalPagePath, testPath];
    const expected = selectPreviewInspectorFastReverseProbePaths(
      paths,
      projectRoot,
      valueConsumerPath,
    );
    const index = createPreviewInspectorFastPageCandidateIndex(paths, projectRoot);
    const basename = vi.spyOn(path, 'basename');
    const collation = vi.spyOn(String.prototype, 'localeCompare');
    index.selectReverseProbes(targetPath);
    expect(basename).toHaveBeenCalled();
    expect(collation).toHaveBeenCalled();
    basename.mockClear();
    collation.mockClear();
    expect(index.selectReverseProbes(valueConsumerPath)).toEqual(expected);
    expect(basename).not.toHaveBeenCalled();
    expect(collation).not.toHaveBeenCalled();
    basename.mockRestore();
    collation.mockRestore();
  });

  it('preserves stable ties between distinct Unicode spellings with equal native collation', () => {
    const composed = path.join(projectRoot, 'src/feature/pages/café-page.tsx');
    const decomposed = path.join(projectRoot, 'src/feature/pages/cafe\u0301-page.tsx');
    expect(composed.localeCompare(decomposed)).toBe(0);
    const paths = [decomposed, legalPagePath, composed, targetPath, remotePagePath];
    const index = createPreviewInspectorFastPageCandidateIndex(paths, projectRoot);
    for (const pivot of [targetPath, valueConsumerPath, remotePagePath]) {
      const expected = selectPreviewInspectorFastReverseProbePaths(paths, projectRoot, pivot);
      expect(index.selectReverseProbes(pivot)).toEqual(expected);
      expect(expected.indexOf(decomposed)).toBeLessThan(expected.indexOf(composed));
    }
  });
});
