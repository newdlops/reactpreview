/** Verifies the bounded source preselector's indexed reverse-import traversal. */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectPreviewRenderRelevantSourcePaths } from '../../../../src/adapters/esbuild/renderGraph/previewRenderSourceSelection';

const ROOT = '/workspace/apps/web/src';

describe('selectPreviewRenderRelevantSourcePaths', () => {
  /** Walks a deep relative-import chain without invoking the more expensive project resolver. */
  it('indexes relative imports once for a large transitive consumer closure', () => {
    const sourceTextByPath = new Map<string, string>();
    const moduleCount = 4_000;
    for (let index = 0; index < moduleCount; index += 1) {
      const sourcePath = `${ROOT}/Module${index.toString()}.tsx`;
      sourceTextByPath.set(
        sourcePath,
        index === 0
          ? 'export const Target = () => null;'
          : `import './Module${(index - 1).toString()}';`,
      );
    }
    let resolverCalls = 0;

    const selected = selectPreviewRenderRelevantSourcePaths(
      sourceTextByPath,
      `${ROOT}/Module0.tsx`,
      () => {
        resolverCalls += 1;
        return undefined;
      },
    );

    expect(selected).toHaveLength(moduleCount);
    expect(selected.at(-1)).toBe(`${ROOT}/Module3999.tsx`);
    expect(resolverCalls).toBe(0);
  });

  /** Uses basename buckets only as candidates and keeps exact project resolution authoritative. */
  it('resolves plausible aliases once and ignores unrelated alias buckets', () => {
    const targetPath = `${ROOT}/Target.tsx`;
    const pagePath = `${ROOT}/Page.tsx`;
    const entryPath = `${ROOT}/main.tsx`;
    const wrongTargetConsumer = `${ROOT}/WrongTargetConsumer.tsx`;
    const sources = new Map<string, string>([
      [targetPath, 'export const Target = () => null;'],
      [pagePath, "import { Target } from './Target';"],
      [entryPath, "import { Page } from '@app/Page';"],
      [wrongTargetConsumer, "import { Target } from '@other/Target';"],
      ...Array.from(
        { length: 500 },
        (_, index) =>
          [
            `${ROOT}/noise/Noise${index.toString()}.tsx`,
            `import '@noise/Unrelated${index.toString()}';`,
          ] as const,
      ),
    ]);
    const resolvedSpecifiers: string[] = [];

    const selected = selectPreviewRenderRelevantSourcePaths(sources, targetPath, (specifier) => {
      resolvedSpecifiers.push(specifier);
      if (specifier === '@app/Page') {
        return pagePath;
      }
      if (specifier === '@other/Target') {
        return `${ROOT}/different/Target.tsx`;
      }
      return undefined;
    });

    expect(selected).toEqual([targetPath, pagePath, entryPath]);
    expect(resolvedSpecifiers.sort()).toEqual(['@app/Page', '@other/Target']);
  });

  /** Retains an arbitrary alias when no basename/suffix candidate can initially reach the target. */
  it('falls back once to exact resolution for a non-suffix monorepo alias', () => {
    const targetPath = '/workspace/packages/ui/src/Target.tsx';
    const pagePath = `${ROOT}/Page.tsx`;
    const entryPath = `${ROOT}/main.tsx`;
    const sources = new Map<string, string>([
      [targetPath, 'export const Target = () => null;'],
      [pagePath, "import { Target } from '@acme/design-surface';"],
      [entryPath, "import { Page } from './Page';"],
    ]);

    const selected = selectPreviewRenderRelevantSourcePaths(sources, targetPath, (specifier) =>
      specifier === '@acme/design-surface' ? targetPath : undefined,
    );

    expect(selected).toEqual([targetPath, pagePath, entryPath]);
  });

  /** Treats an extensionless directory import as the authored directory's index source. */
  it('preserves directory-index module equivalence', () => {
    const targetPath = `${ROOT}/widgets/index.tsx`;
    const pagePath = `${ROOT}/Page.tsx`;
    const sources = new Map<string, string>([
      [targetPath, 'export const Widget = () => null;'],
      [pagePath, "import { Widget } from './widgets';"],
    ]);

    const selected = selectPreviewRenderRelevantSourcePaths(sources, targetPath, () => undefined);

    expect(selected).toEqual([targetPath, pagePath]);
  });

  /** Canonicalizes an existing symlinked consumer parent before resolving its relative import. */
  it('matches relative consumers across canonical parent aliases', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'react-preview-render-graph-'));
    const realSourceRoot = path.join(temporaryRoot, 'real-src');
    const linkedSourceRoot = path.join(temporaryRoot, 'linked-src');
    const targetPath = path.join(realSourceRoot, 'widgets', 'index.tsx');
    const realPagePath = path.join(realSourceRoot, 'Page.tsx');
    const linkedPagePath = path.join(linkedSourceRoot, 'Page.tsx');
    try {
      mkdirSync(path.dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, 'export const Widget = () => null;');
      writeFileSync(realPagePath, "import { Widget } from './widgets';");
      symlinkSync(
        realSourceRoot,
        linkedSourceRoot,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const sources = new Map<string, string>([
        [targetPath, 'export const Widget = () => null;'],
        [linkedPagePath, "import { Widget } from './widgets';"],
      ]);

      const selected = selectPreviewRenderRelevantSourcePaths(sources, targetPath, () => undefined);

      expect(selected).toEqual([targetPath, linkedPagePath]);
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });
});
