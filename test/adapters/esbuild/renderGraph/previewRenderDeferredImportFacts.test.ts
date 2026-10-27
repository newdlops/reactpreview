/** Regressions for named deferred exports passed through authored factory arguments. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPreviewRenderModuleFacts } from '../../../../src/adapters/esbuild/renderGraph/previewRenderModuleFacts';
import { createPreviewRenderChainPlans } from '../../../../src/adapters/esbuild/renderGraph/previewRenderChainPlanner';

const ROOT = '/workspace/src';
const APP = `${ROOT}/App.tsx`;
const PAGE = `${ROOT}/Feature.tsx`;
const ENTRY = `${ROOT}/index.tsx`;

describe('deferred factory export transport', () => {
  it('connects only the selected export to an authentic entry through a factory result', async () => {
    const sources = new Map([
      [PAGE, 'export const Feature = () => <main />; export const Other = () => <aside />;'],
      [
        APP,
        [
          "import { createSection } from './factory';",
          "const Section = createSection('team', '/team', () => import('./Feature').then(module => module.Feature));",
          'export const App = () => <Section />;',
        ].join('\n'),
      ],
      [
        ENTRY,
        "import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.body).render(<App />);",
      ],
    ]);
    const plans = await createPreviewRenderChainPlans({
      documentPath: PAGE,
      exportNames: ['Feature', 'Other'],
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) =>
        sources.has(path.resolve(path.dirname(importer), specifier + '.tsx'))
          ? path.resolve(path.dirname(importer), specifier + '.tsx')
          : undefined,
      sourcePaths: [...sources.keys()],
    });
    expect(plans.Feature?.reachability).toBe('entry-connected');
    expect(plans.Feature?.paths[0]?.entryPoint?.sourcePath).toBe(ENTRY);
    expect(plans.Feature?.paths[0]?.steps.some((step) => step.label === 'Section')).toBe(true);
    expect(plans.Feature?.paths[0]?.steps.some((step) => step.kind === 'value-flow')).toBe(true);
    expect(plans.Other?.reachability).toBe('entry-unreachable');
  });

  it('keeps an explicit single-return loader and selector as conditional value flow', () => {
    const facts = collectPreviewRenderModuleFacts(
      APP,
      "const Section = compose(() => { return import('./Feature').then(module => { return module.Feature; }); });",
    );
    expect(facts.lazyImports).toEqual([
      expect.objectContaining({
        importedName: 'Feature',
        kind: 'value-flow',
        moduleSpecifier: './Feature',
        ownerId: facts.values[0]?.id,
      }),
    ]);
  });

  it.each([
    "compose(() => import('./Feature'))",
    "compose(() => import('./Feature').then(module => module[key]))",
    "compose(() => import('./Feature').then(module => other.Feature))",
    "compose(() => import('./Feature').then(module => choose(module.Feature)))",
    "compose(() => import('./Feature').then(module => { record(module); return module.Feature; }))",
    "compose(() => { record(); return import('./Feature').then(module => module.Feature); })",
    "compose(() => nested(() => import('./Feature').then(module => module.Feature)))",
    'compose(() => import(source).then(module => module.Feature))',
    "compose(() => import('./Feature').then(module => module.Feature, onError))",
    "compose((input) => import('./Feature').then(module => module.Feature))",
  ])('leaves opaque loader expressions unconnected: %s', (expression) => {
    expect(
      collectPreviewRenderModuleFacts(APP, `const Section = ${expression};`).lazyImports,
    ).toEqual([]);
  });

  it('preserves React lazy and its exact export adapter without duplicating its import', () => {
    const facts = collectPreviewRenderModuleFacts(
      APP,
      "import { lazy as defer } from 'react'; const Section = defer(() => import('./Feature').then(module => ({ default: module.Feature }))); ",
    );
    expect(facts.lazyImports).toEqual([
      expect.objectContaining({ importedName: 'Feature', moduleSpecifier: './Feature' }),
    ]);
    expect(facts.lazyImports[0]).not.toHaveProperty('kind');
  });
});
