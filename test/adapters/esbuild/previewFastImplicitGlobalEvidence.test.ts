/**
 * Verifies that latency-bounded Page Inspector preparation keeps bootstrap globals from its
 * already-proven application corridor without reopening a package-wide source inventory.
 */
import { describe, expect, it } from 'vitest';
import { preparePreviewImplicitGlobalEvidence } from '../../../src/adapters/esbuild/previewFastImplicitGlobalEvidence';
import { PreviewImplicitGlobalEvidenceCache } from '../../../src/adapters/esbuild/previewImplicitGlobalEvidenceCache';

/** Stable empty snapshots used by syntax-only source-reader fixtures. */
const EMPTY_SNAPSHOTS = new Map<string, string>();

describe('preparePreviewImplicitGlobalEvidence', () => {
  /**
   * The real app entry frequently assigns configured wrappers to ambient globals. Fast mode must
   * reproduce that assignment because the entry belongs to the selected page path, while unrelated
   * project files remain outside the latency-sensitive scan.
   */
  it('collects runtime assignments only from the proven Page Inspector corridor', async () => {
    const entryPath = '/workspace/src/index.tsx';
    const pagePath = '/workspace/src/pages/CompanyPage.tsx';
    const targetPath = '/workspace/src/components/TargetCard.tsx';
    const decimalPath = '/workspace/src/runtime/decimal.ts';
    const unrelatedPath = '/workspace/src/unrelated-bootstrap.ts';
    const sources = new Map<string, string>([
      [
        entryPath,
        [
          "import decimalValue from './runtime/decimal';",
          'globalThis.decimal = decimalValue;',
        ].join('\n'),
      ],
      [pagePath, "import TargetCard from '../components/TargetCard'; export default TargetCard;"],
      [targetPath, 'export default function TargetCard() { return null; }'],
      [unrelatedPath, "import clock from './runtime/clock'; globalThis.clock = clock;"],
    ]);
    const readPaths: string[] = [];

    const result = await preparePreviewImplicitGlobalEvidence({
      cache: new PreviewImplicitGlobalEvidenceCache(),
      cacheKey: '/workspace\0nearest-config',
      fallbackSourcePaths: [...sources.keys()],
      fast: true,
      inspectorDependencyPaths: [entryPath, pagePath, targetPath],
      pageInspector: true,
      prioritizedSourcePath: entryPath,
      readSource: (sourcePath) => {
        readPaths.push(sourcePath);
        return sources.get(sourcePath);
      },
      resolveModule: (moduleSpecifier, sourcePath) =>
        moduleSpecifier === './runtime/decimal' && sourcePath === entryPath
          ? decimalPath
          : undefined,
      runtimeDependencyPaths: [],
      snapshotSourceByPath: EMPTY_SNAPSHOTS,
    });

    expect(result.evidence).toEqual([
      {
        evidenceKind: 'runtime-assignment',
        exportKind: 'default',
        globalName: 'decimal',
        modulePath: decimalPath,
        moduleSpecifier: './runtime/decimal',
        sourcePath: entryPath,
      },
    ]);
    expect(readPaths).toEqual([entryPath]);
    expect(readPaths).not.toContain(unrelatedPath);
  });

  /**
   * Large Inspector graphs must be reduced before the strict collector sees them. A proven entry
   * remains usable, but omitted conventional candidates keep the inventory explicitly incomplete so
   * the fast app shell can be enriched in the background.
   */
  it('preselects a proven entry from an oversized dependency corridor', async () => {
    const entryPath = '/workspace/src/startup.tsx';
    const valuePath = '/workspace/src/runtime/dayjs.ts';
    const dependencyPaths = Array.from(
      { length: 3_190 },
      (_, index) => `/workspace/src/features/feature-${index.toString()}/index.tsx`,
    );
    dependencyPaths.push(entryPath);
    let readCount = 0;

    const result = await preparePreviewImplicitGlobalEvidence({
      cache: new PreviewImplicitGlobalEvidenceCache(),
      cacheKey: '/workspace\0nearest-config',
      fallbackSourcePaths: dependencyPaths,
      fast: true,
      inspectorDependencyPaths: dependencyPaths,
      pageInspector: true,
      prioritizedSourcePath: entryPath,
      readSource: (sourcePath) => {
        readCount += 1;
        return sourcePath === entryPath
          ? "import dayjsValue from './runtime/dayjs'; globalThis.dayjs = dayjsValue;"
          : 'export const barrel = true;';
      },
      resolveModule: (moduleSpecifier, sourcePath) =>
        moduleSpecifier === './runtime/dayjs' && sourcePath === entryPath ? valuePath : undefined,
      runtimeDependencyPaths: [],
      snapshotSourceByPath: EMPTY_SNAPSHOTS,
    });

    expect(result.truncated).toBe(true);
    expect(result.evidence[0]).toMatchObject({
      globalName: 'dayjs',
      modulePath: valuePath,
      sourcePath: entryPath,
    });
    expect(readCount).toBeLessThanOrEqual(256);
  });

  /** A failed current-source read cannot silently turn an unknown bootstrap into complete evidence. */
  it('marks an unreadable prioritized entry as truncated', async () => {
    const entryPath = '/workspace/src/main.tsx';
    const result = await preparePreviewImplicitGlobalEvidence({
      cache: new PreviewImplicitGlobalEvidenceCache(),
      cacheKey: '/workspace\0nearest-config',
      fallbackSourcePaths: [entryPath],
      fast: true,
      inspectorDependencyPaths: [entryPath],
      pageInspector: true,
      prioritizedSourcePath: entryPath,
      readSource: () => {
        throw new Error('snapshot unavailable');
      },
      resolveModule: () => undefined,
      runtimeDependencyPaths: [],
      snapshotSourceByPath: EMPTY_SNAPSHOTS,
    });

    expect(result.evidence).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  /** Export galleries have no authored app corridor and therefore retain the zero-scan fast path. */
  it('does not inspect fallback inventory for a fast non-page preview', async () => {
    let readCount = 0;

    const result = await preparePreviewImplicitGlobalEvidence({
      cache: new PreviewImplicitGlobalEvidenceCache(),
      cacheKey: '/workspace\0nearest-config',
      fallbackSourcePaths: ['/workspace/src/index.tsx'],
      fast: true,
      inspectorDependencyPaths: ['/workspace/src/index.tsx'],
      pageInspector: false,
      prioritizedSourcePath: undefined,
      readSource: () => {
        readCount += 1;
        return "import value from './value'; globalThis.value = value;";
      },
      resolveModule: () => '/workspace/src/value.ts',
      runtimeDependencyPaths: [],
      snapshotSourceByPath: EMPTY_SNAPSHOTS,
    });

    expect(result.evidence).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(readCount).toBe(0);
  });

  /** Full preparation keeps the existing package-inventory cache contract unchanged. */
  it('retains fallback inventory discovery for full preparation without an inspector corridor', async () => {
    const bootstrapPath = '/workspace/src/bootstrap.ts';
    const valuePath = '/workspace/src/value.ts';

    const result = await preparePreviewImplicitGlobalEvidence({
      cache: new PreviewImplicitGlobalEvidenceCache(),
      cacheKey: '/workspace\0nearest-config',
      fallbackSourcePaths: [bootstrapPath],
      fast: false,
      inspectorDependencyPaths: [],
      pageInspector: false,
      prioritizedSourcePath: undefined,
      readSource: (sourcePath) =>
        sourcePath === bootstrapPath
          ? "import value from './value'; globalThis.previewValue = value;"
          : undefined,
      resolveModule: (moduleSpecifier) => (moduleSpecifier === './value' ? valuePath : undefined),
      runtimeDependencyPaths: [],
      snapshotSourceByPath: EMPTY_SNAPSHOTS,
    });

    expect(result.evidence[0]).toMatchObject({
      globalName: 'previewValue',
      modulePath: valuePath,
      sourcePath: bootstrapPath,
    });
  });
});
