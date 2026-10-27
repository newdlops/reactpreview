/** Shared deterministic fixtures for previewInspectorRootPlugin regression scenarios. */
import { type PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector';

export const TARGET_PATH = '/workspace/application/Target.tsx';

export const PAGE_PATH = '/workspace/application/Page.tsx';

export const ALTERNATE_PAGE_PATH = '/workspace/application/AlternatePage.tsx';

/** Narrow observable surface of the generated legacy-and-Next-15 compatible route record. */
export interface NextAppCompatRecord extends PromiseLike<Readonly<Record<string, unknown>>> {
  readonly accountId: string;
  readonly status: 'fulfilled';
  readonly value: Readonly<Record<string, unknown>>;
}

/** Creates the minimum immutable plan used by source-generation assertions. */
export function createPlan(
  root: PreviewInspectorAncestorPlan['root'],
): PreviewInspectorAncestorPlan {
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
    rootOwnsRouter: false,
    rootStepIndex: 3,
    routeLocation: {
      componentName: 'Target',
      dependencyPaths: ['/workspace/application/pages.json'],
      evidenceKind: 'route-catalog' as const,
      pathname: '/company/1/target',
      pattern: '/company/:companyId(\\d+)/target',
      sourcePath: '/workspace/application/pages.json',
    },
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
