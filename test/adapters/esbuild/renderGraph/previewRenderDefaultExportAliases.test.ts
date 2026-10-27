/** Verifies transparent default syntax keeps exact declaration identity through real entry discovery. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createPreviewRenderChainPlans,
  type PreviewRenderChainPlansByExport,
} from '../../../../src/adapters/esbuild/renderGraph';
import { collectPreviewRenderModuleFacts } from '../../../../src/adapters/esbuild/renderGraph/previewRenderModuleFacts';

const ROOT = '/workspace/src';
const TARGET = `${ROOT}/app.tsx`;
const ENTRY = `${ROOT}/main.tsx`;
const DECLARATIONS = [
  'export const FeatureApp = createModule("/feature", {}, [], ({ routes }) => <Routes>{routes}</Routes>);',
  'export const OtherApp = createModule("/other", {}, [], ({ routes }) => <Routes>{routes}</Routes>);',
].join('\n');
const TRANSPARENT_DEFAULTS = [
  '(FeatureApp)',
  '(((FeatureApp)))',
  '(FeatureApp as typeof FeatureApp)',
  '(FeatureApp satisfies typeof FeatureApp)',
  '(FeatureApp!)',
  '(((FeatureApp as typeof FeatureApp) satisfies typeof FeatureApp)!)',
];

/** Provides an exact two-module source-only graph; no factory or application expression executes. */
async function collectPlans(
  expression: string,
  consumer: 'named' | 'default',
): Promise<PreviewRenderChainPlansByExport> {
  const sources: Readonly<Record<string, string>> = {
    [TARGET]: `${DECLARATIONS}\nexport default ${expression};`,
    [ENTRY]: [
      "import { createRoot } from 'react-dom/client';",
      consumer === 'named'
        ? "import { FeatureApp } from './app';"
        : "import FeatureApp from './app';",
      'createRoot(document.body).render(<FeatureApp />);',
    ].join('\n'),
  };
  return createPreviewRenderChainPlans({
    documentPath: TARGET,
    exportNames: ['default', 'FeatureApp', 'OtherApp'],
    primaryExportName: 'default',
    readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
    resolveModule: (specifier, importer) => {
      const candidate = `${path.resolve(path.dirname(importer), specifier)}.tsx`;
      return Object.hasOwn(sources, candidate) ? candidate : undefined;
    },
    sourcePaths: Object.keys(sources),
  });
}

describe('transparent default export declaration identity', () => {
  it.each(TRANSPARENT_DEFAULTS)('shares the existing declaration for %s', (expression) => {
    const facts = collectPreviewRenderModuleFacts(
      TARGET,
      `${DECLARATIONS}\nexport default ${expression};`,
    );
    expect(facts.exports.find((value) => value.exportName === 'default')?.localName).toBe(
      'FeatureApp',
    );
    expect(facts.values.map((value) => value.localName)).toEqual(['FeatureApp', 'OtherApp']);
  });

  it.each(TRANSPARENT_DEFAULTS)('finds the named consumer of default %s', async (expression) => {
    const plans = await collectPlans(expression, 'named');
    expect(plans.default?.reachability).toBe('entry-connected');
    expect(plans.default?.paths[0]?.entryPoint?.sourcePath).toBe(ENTRY);
    expect(plans.FeatureApp?.reachability).toBe('entry-connected');
    expect(plans.OtherApp?.reachability).toBe('entry-unreachable');
  });

  it.each(TRANSPARENT_DEFAULTS)('finds the default consumer of %s', async (expression) => {
    const plans = await collectPlans(expression, 'default');
    expect(plans.default?.reachability).toBe('entry-connected');
    expect(plans.FeatureApp?.reachability).toBe('entry-connected');
    expect(plans.OtherApp?.reachability).toBe('entry-unreachable');
  });

  it.each(['wrap(FeatureApp)', '(OtherApp, FeatureApp)', 'condition ? FeatureApp : OtherApp'])(
    'keeps evaluated default %s as a distinct value',
    async (expression) => {
      const facts = collectPreviewRenderModuleFacts(
        TARGET,
        `${DECLARATIONS}\nexport default ${expression};`,
      );
      expect(facts.exports.find((value) => value.exportName === 'default')?.localName).toBe(
        '@default',
      );
      expect(facts.values.map((value) => value.localName)).toContain('@default');
      expect((await collectPlans(expression, 'named')).default?.reachability).toBe(
        'entry-unreachable',
      );
    },
  );
});
