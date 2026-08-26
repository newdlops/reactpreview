import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  selectPreviewInspectorFastPageConsumerPaths,
  selectPreviewInspectorFastReverseProbePaths,
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
});
