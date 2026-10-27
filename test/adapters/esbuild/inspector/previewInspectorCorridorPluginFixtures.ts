/** Shared deterministic fixtures for previewInspectorCorridorPlugin regression scenarios. */
import { type PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector';

/** Creates the minimum immutable plan whose entry and selected module form the allowed corridor. */
export function createCorridorPlan(
  entryPath: string,
  selectedPath: string,
  routeParams?: Readonly<Record<string, string>>,
  evidenceSourcePaths: readonly string[] = [],
  candidateId = 'candidate-selected',
): PreviewInspectorAncestorPlan {
  const target = { exportName: 'default', sourcePath: selectedPath };
  const renderPath = {
    entryPoint: {
      kind: 'create-root' as const,
      occurrenceStart: 0,
      sourcePath: entryPath,
      wrapperNames: [],
    },
    id: `${candidateId}-path`,
    steps: [
      {
        certainty: 'confirmed' as const,
        kind: 'react-lazy' as const,
        label: 'Selected',
        occurrenceStart: 0,
        sourcePath: selectedPath,
        evidenceSourcePaths,
        wrapperNames: [],
      },
      {
        certainty: 'confirmed' as const,
        kind: 'entry-render' as const,
        label: 'entry',
        occurrenceStart: 0,
        sourcePath: entryPath,
        wrapperNames: [],
      },
    ],
  };
  const renderChain = {
    dependencyPaths: [entryPath, selectedPath],
    paths: [renderPath],
    reachability: 'entry-connected' as const,
    target,
    truncated: false,
  };
  const pageCandidate = {
    complete: true,
    dependencyPaths: [entryPath, selectedPath],
    edges: [],
    id: candidateId,
    renderPath,
    root: target,
    rootAutomaticProps: {},
    rootOwnsRouter: false,
    ...(routeParams === undefined
      ? {}
      : {
          routeLocation: {
            componentName: 'NextAppPage' as const,
            evidenceKind: 'next-app-filesystem' as const,
            params: routeParams,
            pathname: `/${Object.values(routeParams).join('/')}`,
            pattern: `/${Object.keys(routeParams)
              .map((name) => `[${name}]`)
              .join('/')}`,
            searchParams: {},
            sourcePath: selectedPath,
          },
        }),
    stopReason: 'root-reached' as const,
    targetAutomaticProps: {},
  };
  return {
    ...pageCandidate,
    pageCandidates: [pageCandidate],
    renderChain,
    renderChainsByExport: { default: renderChain },
    target,
  };
}
