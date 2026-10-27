/** Shared deterministic fixtures for previewInspectorRouteLocation regression scenarios. */
import path from 'node:path';
import { type CollectPreviewInspectorRouteLocationOptions } from '../../../../src/adapters/esbuild/inspector';
import type { PreviewRenderChainPlan } from '../../../../src/adapters/esbuild/renderGraph';

export const TARGET_PATH = '/workspace/application/src/pages/investment-contract-analysis-page.tsx';

export const APP_PATH = '/workspace/application/src/App.tsx';

export const PAGE_MAP_PATH = '/workspace/application/src/pages-map.ts';

export const PAGE_CATALOG_PATH = '/workspace/application/src/pages.json';

/** Creates the smallest entry-connected graph needed by the route analyzer. */
export function createRenderChain(
  stepSourcePath = APP_PATH,
  targetPath = TARGET_PATH,
  targetLabel = 'InvestmentContractAnalysisPage',
  targetExportName = 'default',
): PreviewRenderChainPlan {
  return {
    dependencyPaths: [TARGET_PATH, stepSourcePath],
    paths: [
      {
        entryPoint: {
          kind: 'create-root',
          occurrenceStart: 100,
          sourcePath: APP_PATH,
          wrapperNames: [],
        },
        id: 'analysis-page-path',
        steps: [
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: targetLabel,
            occurrenceStart: 20,
            sourcePath: stepSourcePath,
            wrapperNames: [],
          },
        ],
      },
    ],
    reachability: 'entry-connected',
    target: { exportName: targetExportName, sourcePath: targetPath },
    truncated: false,
  };
}

/** Creates a virtual, snapshot-like source reader without touching the host filesystem. */
export function createOptions(
  sources: Readonly<Record<string, string>>,
  renderChain = createRenderChain(),
): CollectPreviewInspectorRouteLocationOptions {
  return {
    documentPath: renderChain.target.sourcePath,
    exportName: renderChain.target.exportName,
    readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
    renderChain,
    resolveModule: (specifier, importer) => {
      if (!specifier.startsWith('.')) return undefined;
      const candidate = path.resolve(path.dirname(importer), specifier);
      return [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.json`].find(
        (sourcePath) => Object.hasOwn(sources, sourcePath),
      );
    },
    sourcePaths: Object.keys(sources).filter((sourcePath) => !sourcePath.endsWith('.json')),
  };
}
