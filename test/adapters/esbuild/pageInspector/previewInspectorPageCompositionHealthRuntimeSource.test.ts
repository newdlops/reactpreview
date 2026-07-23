/** Verifies bounded page-composition health summaries without mounting React or project modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_INSPECTOR_PAGE_COMPOSITION_ROW_LIMIT,
  createPreviewInspectorPageCompositionHealthRuntimeSource,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCompositionHealthRuntimeSource';

/** Serializable event shape captured from the generated browser helper. */
interface PageCompositionRecord {
  readonly category: string;
  readonly detail: {
    readonly applicationPath: readonly string[];
    readonly authoredStaticPath: readonly string[];
    readonly blockerSummary: {
      readonly active: number;
      readonly items: readonly { readonly name: string; readonly ownerPath: string }[];
    };
    readonly candidate: { readonly complete: boolean; readonly rootExport: string };
    readonly missingShellNames: readonly string[];
    readonly observedFiberPath: readonly string[];
    readonly statusCounts: {
      readonly currentFileMounted: number;
      readonly expected: number;
      readonly hostOutput: number;
      readonly mounted: number;
    };
    readonly targetState: {
      readonly hasOutput: boolean;
      readonly pageRootCommitted: boolean;
      readonly stage: string;
    };
    readonly treeRows: readonly {
      readonly blocker: boolean;
      readonly currentFile: boolean;
      readonly depth: number;
      readonly mounted: boolean;
      readonly name: string;
      readonly state: string;
    }[];
    readonly treeRowsTruncated: boolean;
  };
  readonly event: string;
}

/** Browser helpers exported by the isolated fixture. */
interface PageCompositionFixture {
  readonly create: (snapshot: unknown) => {
    readonly detail: PageCompositionRecord['detail'];
    readonly digest: string;
  };
  readonly records: PageCompositionRecord[];
  readonly record: (snapshot: unknown) => void;
}

describe('Preview Inspector page-composition health runtime source', () => {
  /** Summarizes selected page identity, target reachability, shell gaps, and blocker ownership. */
  it('emits one readable bounded snapshot for a mixed live and expected page tree', () => {
    const runtime = createPageCompositionFixture();
    const snapshot = {
      hostNodesById: new Map([['target', [{ isConnected: true }]]]),
      roots: [
        {
          children: [
            {
              children: [
                {
                  children: [
                    {
                      blockerKind: 'data-request',
                      children: [],
                      id: 'request',
                      kind: 'blocker',
                      name: 'Backend data · GET /items',
                    },
                  ],
                  currentFileExport: true,
                  id: 'target',
                  kind: 'target',
                  mounted: true,
                  name: 'TargetPanel',
                },
                {
                  children: [],
                  contextOnly: true,
                  edgeKind: 'expected-jsx-component',
                  expectedOutput: true,
                  id: 'expected-nav',
                  kind: 'component',
                  name: 'SideNavigation',
                },
              ],
              contextOnly: true,
              id: 'page',
              kind: 'root',
              name: 'PageRoot',
            },
          ],
          contextOnly: true,
          id: 'workspace',
          kind: 'entry',
          name: 'Workspace React render root',
        },
      ],
      status: 'Live page tree',
      truncated: false,
    };

    const health = runtime.create(snapshot);
    runtime.record(health);

    expect(runtime.records).toHaveLength(1);
    expect(runtime.records[0]).toMatchObject({
      category: 'page-composition',
      detail: {
        applicationPath: ['Application', 'MissingShell', 'PageRoot', 'TargetPanel'],
        authoredStaticPath: ['Application', 'MissingShell', 'PageRoot', 'TargetPanel'],
        blockerSummary: {
          active: 1,
          items: [
            {
              name: 'Backend data · GET /items',
              ownerPath: 'Workspace React render root > PageRoot > TargetPanel',
            },
          ],
        },
        candidate: { complete: true, rootExport: 'Application' },
        missingShellNames: ['Application', 'MissingShell', 'PageRoot'],
        observedFiberPath: ['TargetPanel'],
        statusCounts: { currentFileMounted: 1, expected: 1, hostOutput: 1 },
        targetState: {
          hasOutput: true,
          pageRootCommitted: true,
          stage: 'target-output',
        },
      },
      event: 'page-composition-snapshot',
    });
    expect(health.detail.treeRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blocker: false,
          currentFile: true,
          mounted: true,
          name: 'TargetPanel',
          state: 'mounted-output',
        }),
        expect.objectContaining({
          name: 'SideNavigation',
          state: 'expected',
        }),
      ]),
    );
  });

  /** Caps serialized rows while aggregate counts continue across a broader component tree. */
  it('keeps broad page trees inside the health transport budget', () => {
    const runtime = createPageCompositionFixture();
    const snapshot = {
      roots: Array.from(
        { length: PREVIEW_INSPECTOR_PAGE_COMPOSITION_ROW_LIMIT + 20 },
        (_, index) => ({
          children: [],
          currentFileExport: index === PREVIEW_INSPECTOR_PAGE_COMPOSITION_ROW_LIMIT + 19,
          id: 'component-' + String(index),
          kind: 'component',
          mounted: true,
          name: 'Component' + String(index),
        }),
      ),
    };

    const first = runtime.create(snapshot);
    const second = runtime.create(snapshot);

    expect(first.detail.treeRows).toHaveLength(PREVIEW_INSPECTOR_PAGE_COMPOSITION_ROW_LIMIT);
    expect(first.detail.treeRowsTruncated).toBe(true);
    expect(first.detail.statusCounts.mounted).toBe(
      PREVIEW_INSPECTOR_PAGE_COMPOSITION_ROW_LIMIT + 20,
    );
    expect(first.detail.treeRows.at(-1)).toMatchObject({
      currentFile: true,
      name: `Component${(PREVIEW_INSPECTOR_PAGE_COMPOSITION_ROW_LIMIT + 19).toString()}`,
    });
    expect(second.digest).toBe(first.digest);
  });
});

/** Evaluates generated page-composition source against one deterministic page candidate. */
function createPageCompositionFixture(): PageCompositionFixture {
  const context: { __runtime?: PageCompositionFixture } = {};
  vm.runInNewContext(
    `
      const candidate = {
        complete: true,
        id: 'application-page',
        renderPath: { entryPoint: { sourcePath: '/workspace/src/main.tsx' } },
        root: { exportName: 'Application', sourcePath: '/workspace/src/Application.tsx' },
        rootOwnsRouter: true,
        rootStepIndex: 0,
        routeLocation: {
          evidenceKind: 'route-registration',
          pathname: '/items',
          pattern: '/items',
          sourcePath: '/workspace/src/routes.tsx',
        },
      };
      const descriptor = {
        exportName: 'TargetPanel',
        inspector: { target: { exportName: 'TargetPanel' } },
      };
      const reachability = {
        applicationPath: ['Application', 'MissingShell', 'PageRoot', 'TargetPanel'],
        directTarget: false,
        pageRootCommitted: true,
        status: 'reached',
        targetExportName: 'TargetPanel',
        targetHasOutput: true,
        targetMounted: true,
        targetWasMounted: true,
      };
      const records = [];
      const findSelectedPreviewInspectorDescriptor = () => descriptor;
      const readPreviewInspectorPageCandidates = () => [candidate];
      const readSelectedPreviewInspectorPageCandidate = () => candidate;
      const readPreviewInspectorTargetReachabilityState = () => reachability;
      const readPreviewInspectorRenderScenario = () => 'authored-page';
      const isPreviewInspectorBlockingNode = (node) => node?.kind === 'blocker';
      const recordPreviewInspectorRuntimeHealth = (record) => records.push(record);
      ${createPreviewInspectorPageCompositionHealthRuntimeSource()}
      globalThis.__runtime = {
        create: createPreviewInspectorPageCompositionHealthSnapshot,
        record: recordPreviewInspectorPageCompositionHealthSnapshot,
        records,
      };
    `,
    context,
  );
  if (context.__runtime === undefined) {
    throw new Error('Page-composition runtime fixture did not initialize.');
  }
  return context.__runtime;
}
