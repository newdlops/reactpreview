import { describe, expect, it } from 'vitest';
import { selectPreviewStyleSheetManagerPlan } from '../../../src/adapters/esbuild/previewStyleSheetManagerSelection';

describe('selectPreviewStyleSheetManagerPlan', () => {
  it('keeps exact imported manager callbacks and literal options', async () => {
    const sourcePath = '/workspace/App.tsx';
    const plan = await selectPreviewStyleSheetManagerPlan({
      availability: {
        available: true,
        dependencyPaths: ['/workspace/node_modules/styled-components/package.json'],
      },
      mountedRoot: { exportName: 'Page', rootStepIndex: 0, sourcePath: '/workspace/Page.tsx' },
      readSource: () =>
        Promise.resolve(
          "import { StyleSheetManager } from 'styled-components'; import { forward } from './forward'; export const App = () => <StyleSheetManager disableCSSOMInjection shouldForwardProp={forward} />;",
        ),
      renderPath: {
        id: 'path',
        steps: [
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'Page',
            occurrenceStart: 0,
            sourcePath: '/workspace/Page.tsx',
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            kind: 'entry-render',
            label: 'App',
            occurrenceStart: 1,
            sourcePath,
            wrapperNames: [],
          },
        ],
      },
      resolveModule: () => undefined,
    });
    expect(plan.evidence).toBe('authored');
    expect(plan.layers).toEqual([
      {
        disableCSSOMInjection: true,
        shouldForwardProp: {
          access: { kind: 'named', exportName: 'forward' },
          importerPath: sourcePath,
          moduleSpecifier: './forward',
          resolutionKind: 'import-statement',
        },
        sourceKind: 'authored',
      },
    ]);
  });

  it('falls back to a synthetic layer when manager props spread unknown values', async () => {
    const plan = await selectPreviewStyleSheetManagerPlan({
      availability: { available: true, dependencyPaths: [] },
      mountedRoot: { exportName: 'Page', rootStepIndex: 0, sourcePath: '/workspace/Page.tsx' },
      readSource: () =>
        Promise.resolve(
          "import { StyleSheetManager } from 'styled-components'; export const App = (props) => <StyleSheetManager {...props} />;",
        ),
      renderPath: {
        id: 'path',
        steps: [
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'Page',
            occurrenceStart: 0,
            sourcePath: '/workspace/Page.tsx',
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            kind: 'entry-render',
            label: 'App',
            occurrenceStart: 1,
            sourcePath: '/workspace/App.tsx',
            wrapperNames: [],
          },
        ],
      },
      resolveModule: () => undefined,
    });
    expect(plan).toMatchObject({ evidence: 'synthetic', ignoredReasons: ['spread-props'] });
  });
});
