/** Covers targetOwnership behavior for previewInspectorRootPlugin. */
/** Verifies authored-source previewInspectorRootPlugin invariants. */

import { describe, expect, it } from 'vitest';

import {
  createPreviewInspectorRootSource,
  type PreviewInspectorPageExecutionCandidate,
} from '../../../../src/adapters/esbuild/inspector';

import { createPlan, PAGE_PATH, TARGET_PATH } from './previewInspectorRootPluginFixtures';

describe('createPreviewInspectorRootSource', () => {
  /** Registers every proven current-file component without evaluating it in page-flow mode. */
  it('emits independent lazy definitions for the complete current-file export inventory', () => {
    const plan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const secondaryChain = {
      ...plan.renderChain,
      target: { exportName: 'SecondaryCard', sourcePath: TARGET_PATH },
    };
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        renderChainsByExport: {
          ...plan.renderChainsByExport,
          SecondaryCard: secondaryChain,
        },
      },
    });

    expect(source).toContain('direct-target:Target');
    expect(source).toContain('direct-target:SecondaryCard');
    expect(source).toContain('react-preview:inspector-direct-target/SecondaryCard');
    expect(source).not.toContain('direct-target:*');
  });

  /** A detached leaf slice must not materialize the complete selected app in dormant chunks. */
  it('omits direct target loaders beside a frozen route-page execution slice', () => {
    const plan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const browserCandidate = plan.pageCandidates[0];
    if (browserCandidate === undefined) throw new Error('Expected one page candidate.');
    const pageExecutionCandidate = {
      browserCandidate: {
        ...browserCandidate,
        root: { exportName: 'InlineLayout', sourcePath: TARGET_PATH },
        rootAutomaticProps: {},
        rootInference: {
          provenance: [{ kind: 'object', path: 'project', source: 'usage' }],
          shape: {
            kind: 'object',
            properties: { project: { kind: 'object', properties: {} } },
          },
        },
        rootOwnsRouter: false,
      },
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'InlineLayout',
          id: 'layout',
          omittedTopLevelEffectCount: 0,
          sourcePath: TARGET_PATH,
          strategy: 'selected-export-slice',
          watchSourcePaths: [TARGET_PATH],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'Page',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: PAGE_PATH,
          strategy: 'authentic-module-export',
          watchSourcePaths: [PAGE_PATH],
        },
      ],
      evidenceSourcePaths: [],
      executionRootContract: {
        exportName: 'InlineLayout',
        sourcePath: TARGET_PATH,
        surfaceId: 'layout',
      },
      executionRootSurfaceId: 'layout',
      fidelity: 'page-authentic',
      id: 'frozen-route-page',
      optionalSurfaces: [],
      routeRecipe: {
        kind: 'react-router-v6',
        loaderPolicy: 'never-execute',
        mounts: [
          {
            basePath: '/',
            childSurfaceId: 'page',
            contextPattern: '/*',
            hasWildcardFallback: false,
            parentSurfaceId: 'layout',
            pattern: '/page',
          },
        ],
        params: {},
        pattern: '/page',
        pathname: '/page',
        rootOwnsRouter: false,
        searchParams: {},
      },
      runtimeTargetSurfaceId: 'page',
      runtimeTargetContract: {
        exportName: 'Page',
        sourcePath: PAGE_PATH,
        surfaceId: 'page',
      },
      watchSourcePaths: [TARGET_PATH, PAGE_PATH],
    } as PreviewInspectorPageExecutionCandidate;
    const source = createPreviewInspectorRootSource({
      pageExecutionCandidate,
      pageExecutionCandidates: [pageExecutionCandidate],
      plan,
    });

    expect(source).toContain('react-preview:inspector-page-execution');
    expect(source).toContain('"authoredOwnerDepth":');
    expect(source).toContain('"executionRootExportName":"InlineLayout"');
    expect(source).toContain(`"executionRootSourcePath":${JSON.stringify(TARGET_PATH)}`);
    expect(source).toContain('"nestedMountCount":1');
    expect(source).toContain('"executionRootSurfaceId":"layout"');
    expect(source).toContain('"pageRootExportName":"InlineLayout"');
    expect(source).toContain(`"pageRootSourcePath":${JSON.stringify(TARGET_PATH)}`);
    expect(source).toContain('"runtimeTargetSurfaceId":"page"');
    expect(source).toContain(
      `"root":{"exportName":"InlineLayout","sourcePath":${JSON.stringify(TARGET_PATH)}}`,
    );
    expect(source).toContain('"rootInferredPropShape":{"kind":"object","properties":{"project"');
    expect(source).not.toContain('direct-target:Target');
    expect(source).not.toContain('react-preview:inspector-direct-target/Target');
  });

  /** StatusChip mounted by itself (target-only) received no `status` and threw on `.bg`. */
  it('completes target-only root props with the declared required prop values', () => {
    const plan = createPlan({ exportName: 'Target', sourcePath: TARGET_PATH });
    const browserCandidate = plan.pageCandidates[0];
    if (browserCandidate === undefined) throw new Error('Expected one page candidate.');
    const execution = (
      fidelity: 'page-authentic' | 'target-only',
    ): PreviewInspectorPageExecutionCandidate => ({
      browserCandidate: { ...browserCandidate, rootAutomaticProps: {} },
      compositionEdges: [],
      criticalSurfaces: [],
      evidenceSourcePaths: [],
      executionRootContract: {
        exportName: 'Target',
        sourcePath: TARGET_PATH,
        surfaceId: 'target',
      },
      executionRootSurfaceId: 'target',
      fidelity,
      id: `execution-${fidelity}`,
      optionalSurfaces: [],
      runtimeTargetContract: {
        exportName: 'Target',
        sourcePath: TARGET_PATH,
        surfaceId: 'target',
      },
      runtimeTargetSurfaceId: 'target',
      watchSourcePaths: [TARGET_PATH],
    });
    const rootProps = (fidelity: 'page-authentic' | 'target-only'): string => {
      const pageExecutionCandidate = execution(fidelity);
      const source = createPreviewInspectorRootSource({
        pageExecutionCandidate,
        pageExecutionCandidates: [pageExecutionCandidate],
        plan,
        targetTypedProps: { status: 'ok' },
      });
      return /"rootAutomaticProps":(\{[^}]*\})/u.exec(source)?.[1] ?? '';
    };

    expect(rootProps('target-only')).toBe('{"status":"ok"}');
    expect(rootProps('page-authentic')).toBe('{}');
  });

  /**
   * Parses the emitted descriptor JSON to prove static JSX choices cross the extension-host to
   * webview boundary with condition, source, and component-tree evidence intact.
   */
  it('serializes target render outcomes into the browser descriptor', () => {
    const plan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        renderOutcomesByExport: {
          Target: {
            exportName: 'Target',
            outcomes: [
              {
                column: 10,
                componentNames: ['ReadyPanel', 'StatusBadge'],
                componentTree: [
                  {
                    children: [{ children: [], column: 24, line: 12, name: 'StatusBadge' }],
                    column: 10,
                    line: 12,
                    name: 'ReadyPanel',
                  },
                ],
                conditions: [
                  {
                    branch: 'truthy',
                    column: 7,
                    expression: 'ready',
                    id: 'condition-ready',
                    kind: 'if',
                    label: 'truthy',
                    line: 11,
                    selectable: true,
                    sourcePath: TARGET_PATH,
                  },
                ],
                exportName: 'Target',
                id: 'outcome-ready',
                kind: 'jsx',
                label: '<ReadyPanel>',
                line: 12,
                sourcePath: TARGET_PATH,
              },
            ],
            sourcePath: TARGET_PATH,
            truncated: false,
          },
        },
      },
    });
    const descriptorPrefix = 'const __reactPreviewInspectorDescriptor = ';
    const descriptorStart = source.indexOf(descriptorPrefix);
    const descriptorEnd = source.indexOf(';\n', descriptorStart);
    expect(descriptorStart).toBeGreaterThanOrEqual(0);
    expect(descriptorEnd).toBeGreaterThan(descriptorStart);
    const descriptor = JSON.parse(
      source.slice(descriptorStart + descriptorPrefix.length, descriptorEnd),
    ) as {
      readonly inspector?: {
        readonly renderOutcomesByExport?: Readonly<Record<string, unknown>>;
      };
    };

    expect(descriptor.inspector?.renderOutcomesByExport).toMatchObject({
      Target: {
        exportName: 'Target',
        outcomes: [
          {
            componentNames: ['ReadyPanel', 'StatusBadge'],
            componentTree: [
              {
                children: [{ name: 'StatusBadge' }],
                name: 'ReadyPanel',
              },
            ],
            conditions: [
              {
                branch: 'truthy',
                expression: 'ready',
                kind: 'if',
                sourcePath: TARGET_PATH,
              },
            ],
            id: 'outcome-ready',
            sourcePath: TARGET_PATH,
          },
        ],
        sourcePath: TARGET_PATH,
        truncated: false,
      },
    });
  });
});
