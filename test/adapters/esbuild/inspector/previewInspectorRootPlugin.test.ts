/** Verifies that an ancestor plan becomes the existing browser target descriptor contract. */
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorRootSource,
  type PreviewInspectorAncestorPlan,
} from '../../../../src/adapters/esbuild/inspector';

const TARGET_PATH = '/workspace/application/Target.tsx';
const PAGE_PATH = '/workspace/application/Page.tsx';
const ALTERNATE_PAGE_PATH = '/workspace/application/AlternatePage.tsx';

/** Creates the minimum immutable plan used by source-generation assertions. */
function createPlan(root: PreviewInspectorAncestorPlan['root']): PreviewInspectorAncestorPlan {
  const renderChain = {
    dependencyPaths: [PAGE_PATH, TARGET_PATH],
    paths: [],
    reachability: 'entry-unreachable' as const,
    stopReason: 'entry-unreachable' as const,
    target: { exportName: 'Target', sourcePath: TARGET_PATH },
    truncated: false,
  };
  const edges = [
    {
      child: { exportName: 'Target', sourcePath: TARGET_PATH },
      childAutomaticProps: { enabled: true },
      localOwnerDepth: 0,
      localOwnerNames: [],
      occurrenceStart: 42,
      owner: { exportName: 'Page', sourcePath: PAGE_PATH },
    },
  ];
  const pageCandidate = {
    complete: true,
    dependencyPaths: [PAGE_PATH, TARGET_PATH],
    edges,
    id: 'candidate-page',
    root,
    rootAutomaticProps: { route: '/preview' },
    rootInference: {
      provenance: [{ kind: 'string' as const, path: 'companyId', source: 'type' as const }],
      shape: {
        kind: 'object' as const,
        properties: { companyId: { kind: 'string' as const } },
      },
    },
    rootStepIndex: 3,
    stopReason: 'root-reached' as const,
    targetAutomaticProps: { enabled: true },
  };
  return {
    ...pageCandidate,
    renderChain,
    renderChainsByExport: { Target: renderChain },
    pageCandidates: [pageCandidate],
    target: { exportName: 'Target', sourcePath: TARGET_PATH },
  };
}

describe('createPreviewInspectorRootSource', () => {
  /** Imports an actual named owner and exposes ancestry plus editable target/root props. */
  it('emits one real-owner descriptor for the unchanged preview browser entry', () => {
    const source = createPreviewInspectorRootSource({
      displayName: 'Target inspector',
      plan: createPlan({ exportName: 'Page', sourcePath: PAGE_PATH }),
    });

    expect(source).toContain(
      'load: () => import("/workspace/application/Page.tsx").then((module) => module["Page"])',
    );
    expect(source).toContain('"rootAutomaticProps":{"route":"/preview"}');
    expect(source).toContain('"rootInferredPropShape":{"kind":"object"');
    expect(source).toContain('"rootInferredProps":[{"kind":"string","path":"companyId"');
    expect(source).toContain('"rootStepIndex":3');
    expect(source).toContain('"pageCandidates":[{"complete":true');
    expect(source).toContain('"targetAutomaticProps":{"enabled":true}');
    expect(source).toContain('"renderChain":{"dependencyPaths"');
    expect(source).toContain('"renderChainsByExport":{"Target"');
    expect(source).toContain('"reachability":"entry-unreachable"');
    expect(source).toContain('"displayName":"Target inspector"');
    expect(source).toContain('"stopReason":"root-reached"');
    expect(source).toContain('export const previewTheme = undefined;');
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
      'load: () => import("react-preview:inspector-target-facade").then((module) => module["Target"])',
    );
    expect(source).toContain('"inferredPropShape":{"kind":"object"');
    expect(source).toContain('"targetInferredProps":[{"kind":"object","path":"field"');
  });

  /** Emits every alternative behind its own dynamic import and keeps the first path as metadata. */
  it('keeps alternative authored page roots lazy and independently selectable', () => {
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
      'import("/workspace/application/Page.tsx").then((module) => module["Page"])',
    );
    expect(source).toContain(
      'import("/workspace/application/AlternatePage.tsx").then((module) => module["AlternatePage"])',
    );
    expect(source).not.toContain('import __reactPreviewInspectorRoot');
    expect(source).toContain(
      'api.createPageCandidateElement(__reactPreviewInspectorCandidates, props)',
    );
    expect(source).toContain('"id":"candidate-alternate"');
  });
});
