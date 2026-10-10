/** Verifies that an App's default route comes from the branch the preview actually renders. */
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorRouteBranchPlan } from '../../../../src/adapters/esbuild/inspector';
import {
  collectPreviewInspectorEarlyReturnRanges,
  isPreviewInspectorEarlyReturnOccurrence,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteEarlyReturn';
import type { PreviewRenderChainPlan } from '../../../../src/adapters/esbuild/renderGraph';

const APP_PATH = '/workspace/src/App.tsx';
const PAGE_NAMES = ['ResetPasswordPage', 'LoginPage', 'DashboardPage', 'InventoryPage'] as const;

/** A signed-out early return followed by the signed-in routes, as in a typical App root. */
const APP_SOURCE = [
  "import { Navigate, Route, Routes } from 'react-router-dom';",
  ...PAGE_NAMES.map((name) => `import { ${name} } from './pages/${name}';`),
  'export default function App() {',
  '  const token = useToken();',
  '  if (!token)',
  '    return (',
  '      <Routes>',
  '        <Route path="/reset-password" element={<ResetPasswordPage />} />',
  '        <Route path="*" element={<LoginPage />} />',
  '      </Routes>',
  '    );',
  '  return (',
  '    <Routes>',
  '      <Route path="/dashboard" element={<DashboardPage />} />',
  '      <Route path="/inventory" element={<InventoryPage />} />',
  '      <Route path="*" element={<Navigate to="/dashboard" replace />} />',
  '    </Routes>',
  '  );',
  '}',
].join('\n');

/** Creates an entry-connected App target without filesystem discovery. */
function createAppRenderChain(): PreviewRenderChainPlan {
  return {
    dependencyPaths: [APP_PATH],
    paths: [
      {
        entryPoint: {
          kind: 'create-root',
          occurrenceStart: 1,
          sourcePath: APP_PATH,
          wrapperNames: [],
        },
        id: 'app-entry',
        steps: [
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'App',
            occurrenceStart: 10,
            sourcePath: APP_PATH,
            wrapperNames: [],
          },
        ],
      },
    ],
    reachability: 'entry-connected',
    target: { exportName: 'default', sourcePath: APP_PATH },
    truncated: false,
  };
}

describe('early-return route branches', () => {
  it('collects returns inside a guard before the final return only', () => {
    const ranges = collectPreviewInspectorEarlyReturnRanges(APP_PATH, APP_SOURCE);

    expect(ranges).toHaveLength(1);
    expect(
      isPreviewInspectorEarlyReturnOccurrence(ranges, APP_SOURCE.indexOf('/reset-password')),
    ).toBe(true);
    expect(isPreviewInspectorEarlyReturnOccurrence(ranges, APP_SOURCE.indexOf('/dashboard'))).toBe(
      false,
    );
    // A function whose only return sits in a guard has no later branch; a callback owns its own.
    const gateSource = [
      'export function Gate({ open }) {',
      '  if (open) return <Dialog />;',
      '}',
      'export function List({ items }) {',
      '  return items.map((item) => { if (!item) return null; return <Row />; });',
      '}',
    ].join('\n');
    const gateRanges = collectPreviewInspectorEarlyReturnRanges(
      '/workspace/src/Gate.tsx',
      gateSource,
    );
    expect(gateRanges).toHaveLength(1);
    expect(isPreviewInspectorEarlyReturnOccurrence(gateRanges, gateSource.indexOf('<Dialog'))).toBe(
      false,
    );
    expect(
      isPreviewInspectorEarlyReturnOccurrence(gateRanges, gateSource.indexOf('return null')),
    ).toBe(true);
  });

  /** The signed-out `/reset-password` route used to be the default and blanked the App. */
  it('selects the signed-in route by default while keeping the guarded routes selectable', async () => {
    const sources: Readonly<Record<string, string>> = {
      [APP_PATH]: APP_SOURCE,
      ...Object.fromEntries(
        PAGE_NAMES.map((name) => [
          `/workspace/src/pages/${name}.tsx`,
          `export function ${name}() { return <main>${name}</main>; }`,
        ]),
      ),
    };

    const plan = await collectPreviewInspectorRouteBranchPlan({
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      renderChain: createAppRenderChain(),
      resolveModule: (specifier, consumerPath) =>
        consumerPath === APP_PATH && specifier.startsWith('./pages/')
          ? `/workspace/src/pages/${specifier.slice('./pages/'.length)}.tsx`
          : undefined,
      sourcePaths: Object.keys(sources),
    });

    expect(plan.activeLocation).toMatchObject({
      componentName: 'DashboardPage',
      pathname: '/dashboard',
    });
    expect(
      plan.branches.find((branch) => branch.componentName === 'ResetPasswordPage'),
    ).toMatchObject({ pathname: '/reset-password', selectable: true });
  });
});
