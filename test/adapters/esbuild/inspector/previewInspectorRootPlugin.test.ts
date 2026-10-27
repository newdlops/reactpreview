/** Covers descriptors behavior for previewInspectorRootPlugin. */
/** Verifies authored-source previewInspectorRootPlugin invariants. */

import { describe, expect, it } from 'vitest';

import {
  createPreviewInspectorRootSource,
  type PreviewInspectorAncestorPlan,
} from '../../../../src/adapters/esbuild/inspector';

import {
  ALTERNATE_PAGE_PATH,
  createPlan,
  PAGE_PATH,
  TARGET_PATH,
} from './previewInspectorRootPluginFixtures';

describe('createPreviewInspectorRootSource', () => {
  /** Browser blocker discovery must see only the caller path compiled into this artifact. */
  it('removes inactive references of the selected export from descriptor render chains', () => {
    const plan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const createRenderPath = (
      id: string,
      occurrenceStart: number,
    ): PreviewInspectorAncestorPlan['renderChain']['paths'][number] => ({
      id,
      steps: [
        {
          certainty: 'confirmed' as const,
          evidenceSourcePaths: [],
          invocation: {
            calleeName: 'Target',
            mode: 'jsx' as const,
            sourcePath: PAGE_PATH,
          },
          kind: 'component-render' as const,
          label: 'Target',
          occurrenceStart,
          sourcePath: TARGET_PATH,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed' as const,
          evidenceSourcePaths: [],
          kind: 'component-render' as const,
          label: 'Page',
          occurrenceStart: 100,
          sourcePath: PAGE_PATH,
          wrapperNames: [],
        },
      ],
    });
    const selectedRenderPath = createRenderPath('selected-target-reference', 10);
    const inactiveRenderPath = createRenderPath('inactive-target-reference', 20);
    const selectedChain = {
      ...plan.renderChain,
      paths: [selectedRenderPath, inactiveRenderPath],
    };
    const secondaryChain = {
      ...plan.renderChain,
      paths: [createRenderPath('secondary-export-reference', 30)],
      target: { exportName: 'SecondaryCard', sourcePath: TARGET_PATH },
    };
    const firstCandidate = plan.pageCandidates[0];
    if (firstCandidate === undefined) throw new Error('Expected one page candidate.');
    const pageCandidate = {
      ...firstCandidate,
      renderPath: selectedRenderPath,
    };
    const source = createPreviewInspectorRootSource({
      plan: {
        ...plan,
        pageCandidates: [pageCandidate],
        renderChain: selectedChain,
        renderChainsByExport: {
          SecondaryCard: secondaryChain,
          Target: selectedChain,
        },
      },
    });

    expect(source).toContain('selected-target-reference');
    expect(source).not.toContain('inactive-target-reference');
    expect(source).toContain('secondary-export-reference');
  });

  /** Imports an actual named owner and exposes ancestry plus editable target/root props. */
  it('emits one real-owner descriptor for the unchanged preview browser entry', () => {
    const source = createPreviewInspectorRootSource({
      displayName: 'Target inspector',
      plan: createPlan({ exportName: 'Page', sourcePath: PAGE_PATH }),
      targetInference: {
        provenance: [{ kind: 'object', path: 'field', source: 'usage' }],
        shape: { kind: 'object', properties: { field: { kind: 'object', properties: {} } } },
      },
    });

    expect(source).toContain(
      'load: () => Promise.all([import("/workspace/application/Page.tsx")]).then((modules) => __reactPreviewComposeVirtualPage(modules, "Page",',
    );
    expect(source).toContain("import * as React from 'react';");
    expect(source).toContain(
      'directTarget: true, id: "direct-target:Target", targetExportName: "Target", load: () => import("react-preview:inspector-direct-target/Target").then((module) => module.default)',
    );
    expect(source).toContain('"rootAutomaticProps":{"route":"/preview"}');
    expect(source).toContain('"rootInferredPropShape":{"kind":"object"');
    expect(source).toContain('"rootInferredProps":[{"kind":"string","path":"companyId"');
    expect(source).toContain('"rootOwnsRouter":false');
    expect(source).toContain('"rootStepIndex":3');
    expect(source).toContain('"pathname":"/company/1/target"');
    expect(source).toContain('"evidenceKind":"route-catalog"');
    expect(source).toContain('"pageCandidates":[{"complete":true');
    expect(source).toContain('"targetAutomaticProps":{"enabled":true}');
    expect(source).toContain('"targetInferredPropShape":{"kind":"object"');
    expect(source).toContain('"targetInferredProps":[{"kind":"object","path":"field"');
    expect(source).toContain('"renderChain":{"dependencyPaths"');
    expect(source).toContain('"renderChainsByExport":{"Target"');
    expect(source).toContain('"reachability":"entry-unreachable"');
    expect(source).toContain('"displayName":"Target inspector"');
    expect(source).toContain('"stopReason":"root-reached"');
    expect(source).toContain('export const previewTheme = undefined;');
    expect(source).toContain('export const previewGlobalStyles = Object.freeze([]);');
  });

  /** Publishes public route hierarchy metadata without leaking compiler-only component paths. */
  it('serializes route branches without their local source paths', () => {
    const basePlan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const source = createPreviewInspectorRootSource({
      plan: {
        ...basePlan,
        routeBranches: [
          {
            childState: 'leaf',
            componentName: 'SettingsPage',
            depth: 0,
            id: 'route-settings',
            pathname: '/settings',
            pattern: '/settings',
            selectionPath: [{ componentName: 'SettingsPage', pattern: '/settings' }],
            sourcePath: '/private/workspace/SettingsPage.tsx',
          },
        ],
        selectedRouteBranchId: 'route-settings',
      },
      targetInference: { provenance: [], shape: { kind: 'object', properties: {} } },
    });

    expect(source).toContain('"routeBranches":[{"childState":"leaf"');
    expect(source).toContain('"selectedRouteBranchId":"route-settings"');
    expect(source).not.toContain('/private/workspace/SettingsPage.tsx');
  });

  /** Uses the direct facade when the target itself is the best importable mount root. */
  it('keeps direct-root target instrumentation active', () => {
    const source = createPreviewInspectorRootSource({
      plan: createPlan({ exportName: 'Target', sourcePath: TARGET_PATH }),
      targetInference: {
        provenance: [{ kind: 'object', path: 'field', source: 'usage' }],
        shape: { kind: 'object', properties: { field: { kind: 'object', properties: {} } } },
      },
    });

    expect(source).toContain(
      'load: () => Promise.all([import("react-preview:inspector-target-facade")]).then((modules) => __reactPreviewComposeVirtualPage(modules, "Target",',
    );
    expect(source).toContain('"inferredPropShape":{"kind":"object"');
    expect(source).toContain('"targetInferredProps":[{"kind":"object","path":"field"');
  });

  /** Publishes a compiler-derived leaf without replacing the original analysis plan. */
  it('uses runtime ownership only for selected-leaf imports and descriptor identity', () => {
    const plan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const source = createPreviewInspectorRootSource({
      displayName: 'Page.tsx',
      plan,
      runtimeOwnershipTarget: { exportName: 'Page', sourcePath: PAGE_PATH },
      targetInference: {
        provenance: [{ kind: 'object', path: 'appField', source: 'usage' }],
        shape: { kind: 'object', properties: { appField: { kind: 'object', properties: {} } } },
      },
    });

    expect(source).toContain(
      'load: () => Promise.all([import("react-preview:inspector-target-facade")])',
    );
    expect(source).toContain('"displayName":"Page.tsx"');
    expect(source).toContain('"exportName":"Page"');
    expect(source).toContain(
      `"target":{"exportName":"Page","sourcePath":${JSON.stringify(PAGE_PATH)}}`,
    );
    expect(source).not.toContain('direct-target:Target');
    expect(source).not.toContain('"targetInferredProps":[{"kind":"object","path":"appField"');
    expect(plan.target).toEqual({ exportName: 'Target', sourcePath: TARGET_PATH });
  });

  /** Evaluates a proven dependency registry before any selected page module can initialize. */
  it('sequences a render bootstrap ahead of the lazy VirtualPage graph', () => {
    const source = createPreviewInspectorRootSource({
      plan: createPlan({ exportName: 'Page', sourcePath: PAGE_PATH }),
      renderBootstrapSpecifiersByCandidateId: {
        'candidate-page': 'react-preview:inspector-render-bootstrap/candidate-page',
      },
    });

    expect(source).toContain(
      'load: () => import("react-preview:inspector-render-bootstrap/candidate-page").then(() => Promise.all([import("/workspace/application/Page.tsx")])).then((modules) => __reactPreviewComposeVirtualPage',
    );
    expect(source.indexOf('inspector-render-bootstrap')).toBeLessThan(
      source.indexOf('Promise.all([import("/workspace/application/Page.tsx")])'),
    );
  });

  /** Imports only the exact static theme eagerly while retaining every authored page root lazily. */
  it('exposes a page-corridor theme before lazy candidate rendering begins', () => {
    const source = createPreviewInspectorRootSource({
      plan: createPlan({ exportName: 'Page', sourcePath: PAGE_PATH }),
      themeImport: { exportName: 'theme', moduleSpecifier: '/workspace/theme.ts' },
    });

    expect(source).toContain(
      'import { theme as __reactPreviewInspectorTheme } from "/workspace/theme.ts";',
    );
    expect(source).toContain('export const previewTheme = __reactPreviewInspectorTheme;');
    expect(source).toContain(
      'load: () => Promise.all([import("/workspace/application/Page.tsx")])',
    );
  });

  /** Eagerly exposes only proven app-wrapper global styles for composition under the exact theme. */
  it('exports recovered app-level global style components', () => {
    const source = createPreviewInspectorRootSource({
      globalStyleImports: [
        { exportName: 'GlobalStyle', moduleSpecifier: '/workspace/global-style.tsx' },
        { exportName: 'default', moduleSpecifier: '/workspace/reset.tsx' },
      ],
      plan: createPlan({ exportName: 'Page', sourcePath: PAGE_PATH }),
    });

    expect(source).toContain(
      'import { GlobalStyle as __reactPreviewInspectorGlobalStyle0 } from "/workspace/global-style.tsx";',
    );
    expect(source).toContain(
      'import { default as __reactPreviewInspectorGlobalStyle1 } from "/workspace/reset.tsx";',
    );
    expect(source).toContain(
      'export const previewGlobalStyles = Object.freeze([__reactPreviewInspectorGlobalStyle0,__reactPreviewInspectorGlobalStyle1]);',
    );
  });

  /** Imports inert application CSS without evaluating the omitted app wrapper. */
  it('imports recovered application stylesheets in Page Inspector mode', () => {
    const source = createPreviewInspectorRootSource({
      applicationStylesheetImports: [
        {
          importerPath: '/workspace/application/App/index.tsx',
          moduleSpecifier: './fontStyles.css',
        },
      ],
      plan: createPlan({ exportName: 'Page', sourcePath: PAGE_PATH }),
    });

    expect(source).toContain('import "react-preview:application-stylesheet/0";');
    expect(source).not.toContain('/workspace/application/App/index.tsx');
  });

  /** Keeps alternate roots as inert metadata so esbuild receives one executable page graph. */
  it('emits only the selected authored page root while retaining alternate metadata', () => {
    const primaryPlan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const primaryCandidate = primaryPlan.pageCandidates[0];
    if (primaryCandidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const alternateCandidate = {
      ...primaryCandidate,
      id: 'candidate-alternate',
      root: { exportName: 'AlternatePage', sourcePath: ALTERNATE_PAGE_PATH },
      rootAutomaticProps: { route: '/alternate' },
    };
    const source = createPreviewInspectorRootSource({
      plan: {
        ...primaryPlan,
        dependencyPaths: [...primaryPlan.dependencyPaths, ALTERNATE_PAGE_PATH],
        pageCandidates: [...primaryPlan.pageCandidates, alternateCandidate],
      },
    });

    expect(source).toContain(
      'Promise.all([import("/workspace/application/Page.tsx")]).then((modules) => __reactPreviewComposeVirtualPage(modules, "Page",',
    );
    expect(source).not.toContain('import("/workspace/application/AlternatePage.tsx")');
    expect(source).not.toContain('import __reactPreviewInspectorRoot');
    expect(source).toContain(
      'api.createPageCandidateElement(__reactPreviewInspectorCandidates, props)',
    );
    expect(source).toContain('"id":"candidate-alternate"');
    expect(source).toContain('"executablePageCandidateId":"candidate-page"');
    const descriptorLine = source
      .split('\n')
      .find((line) => line.startsWith('const __reactPreviewInspectorDescriptor = '));
    if (descriptorLine === undefined) throw new Error('Inspector descriptor is missing.');
    const descriptor = JSON.parse(
      descriptorLine.slice('const __reactPreviewInspectorDescriptor = '.length).replace(/;$/u, ''),
    ) as {
      readonly inspector: {
        readonly pageCandidates: readonly {
          readonly target?: { readonly exportName: string; readonly sourcePath: string };
        }[];
      };
    };
    expect(descriptor.inspector.pageCandidates.map((candidate) => candidate.target)).toEqual([
      primaryPlan.target,
      primaryPlan.target,
    ]);
  });

  /** Rebuilds one narrow graph when the user chooses a different caller path. */
  it('emits the requested alternate page root and not the previous default', () => {
    const primaryPlan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const primaryCandidate = primaryPlan.pageCandidates[0];
    if (primaryCandidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const source = createPreviewInspectorRootSource({
      plan: {
        ...primaryPlan,
        pageCandidates: [
          primaryCandidate,
          {
            ...primaryCandidate,
            id: 'candidate-alternate',
            root: { exportName: 'AlternatePage', sourcePath: ALTERNATE_PAGE_PATH },
          },
        ],
      },
      selectedPageCandidateId: 'candidate-alternate',
    });

    expect(source).toContain('import("/workspace/application/AlternatePage.tsx")');
    expect(source).not.toContain('import("/workspace/application/Page.tsx")');
    expect(source).toContain('"executablePageCandidateId":"candidate-alternate"');
  });

  /** Keeps cold fast bundles from eagerly traversing alternate app roots in coalesced output. */
  it('can publish only the highest-ranked page candidate for first paint', () => {
    const primaryPlan = createPlan({ exportName: 'Page', sourcePath: PAGE_PATH });
    const primaryCandidate = primaryPlan.pageCandidates[0];
    if (primaryCandidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const source = createPreviewInspectorRootSource({
      maximumPageCandidates: 1,
      plan: {
        ...primaryPlan,
        pageCandidates: [
          primaryCandidate,
          {
            ...primaryCandidate,
            id: 'candidate-expensive-app-root',
            root: { exportName: 'App', sourcePath: ALTERNATE_PAGE_PATH },
          },
        ],
      },
    });

    expect(source).toContain('import("/workspace/application/Page.tsx")');
    expect(source).not.toContain(ALTERNATE_PAGE_PATH);
    expect(source).not.toContain('candidate-expensive-app-root');
  });

  /** Generates the live page from a concrete checkpoint while retaining the authored app root. */
  it('publishes a static-checkpoint VirtualPage before the fast candidate cap', () => {
    const plan = createPlan({ exportName: 'App', sourcePath: ALTERNATE_PAGE_PATH });
    const baseCandidate = plan.pageCandidates[0];
    if (baseCandidate === undefined) throw new Error('Primary candidate fixture is missing.');
    const renderPath = {
      entryPoint: {
        kind: 'create-root' as const,
        occurrenceStart: 1,
        sourcePath: '/workspace/application/main.tsx',
        wrapperNames: [],
      },
      id: 'target-to-entry',
      steps: [
        {
          certainty: 'confirmed' as const,
          kind: 'component-render' as const,
          label: 'Target',
          occurrenceStart: 1,
          sourcePath: TARGET_PATH,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed' as const,
          kind: 'route-branch' as const,
          label: 'Page',
          occurrenceStart: 2,
          sourcePath: PAGE_PATH,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed' as const,
          kind: 'entry-render' as const,
          label: 'App',
          occurrenceStart: 3,
          sourcePath: ALTERNATE_PAGE_PATH,
          wrapperNames: ['GlobalBoundary'],
        },
      ],
    };
    const applicationCandidate = {
      ...baseCandidate,
      id: 'application-root',
      renderPath,
      root: { exportName: 'App', sourcePath: ALTERNATE_PAGE_PATH },
      rootOwnsRouter: true,
      rootStepIndex: 2,
    };
    const pageCandidate = {
      ...baseCandidate,
      complete: false,
      id: 'page-checkpoint',
      renderPath,
      root: { exportName: 'Page', sourcePath: PAGE_PATH },
      rootOwnsRouter: false,
      rootStepIndex: 1,
      stopReason: 'render-path-checkpoint' as const,
    };
    const source = createPreviewInspectorRootSource({
      maximumPageCandidates: 1,
      plan: {
        ...plan,
        pageCandidates: [applicationCandidate, pageCandidate],
        shallowVisualPaths: [
          {
            exportName: 'ApplicationLayout',
            importerPath: ALTERNATE_PAGE_PATH,
            importKind: 'static',
            localEdges: [],
            moduleSpecifier: './ApplicationLayout',
            occurrenceStart: 4,
            relation: 'wrapper',
            renderedLocalName: 'ApplicationLayout',
            renderBoundaryStart: 3,
            selectedChildPath: PAGE_PATH,
            sourcePath: '/workspace/application/ApplicationLayout.tsx',
          },
        ],
      },
    });

    expect(source).toContain(
      'Promise.all([import("/workspace/application/Page.tsx"),import("/workspace/application/ApplicationLayout.tsx")]).then((modules) => __reactPreviewComposeVirtualPage(modules, "Page", ["ApplicationLayout"],',
    );
    expect(source).not.toContain(`import(${JSON.stringify(ALTERNATE_PAGE_PATH)})`);
    expect(source).toContain('"mode":"static-page-checkpoint"');
    expect(source).toContain(
      '"authoredRoot":{"exportName":"App","sourcePath":"/workspace/application/AlternatePage.tsx"}',
    );
    expect(source).toContain(
      '"contentRoot":{"exportName":"Page","sourcePath":"/workspace/application/Page.tsx"}',
    );
    expect(source).toContain('"bypassedStepCount":1');
  });
});
