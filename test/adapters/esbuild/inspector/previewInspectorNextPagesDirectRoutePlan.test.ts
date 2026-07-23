/** Verifies first-paint Pages Router composition without a package-wide source inventory. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorNextPagesDirectRoutePlan,
  isPreviewInspectorNextPagesDirectRoutePath,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorNextPagesDirectRoutePlan';

/** Creates a normalized inert fixture reader and exact relative-import resolver. */
function createFixture(sources: Readonly<Record<string, string>>): {
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, consumer: string) => string | undefined;
} {
  const sourceByPath = new Map(
    Object.entries(sources).map(([sourcePath, sourceText]) => [
      path.normalize(sourcePath),
      sourceText,
    ]),
  );
  return {
    readSource: (sourcePath) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
    resolveModule: (specifier, consumer) => {
      if (!specifier.startsWith('.')) return undefined;
      const base = path.resolve(path.dirname(consumer), specifier);
      return [base, ...['.tsx', '.ts', '.jsx', '.js'].map((extension) => base + extension)].find(
        (candidate) => sourceByPath.has(path.normalize(candidate)),
      );
    },
  };
}

describe('createPreviewInspectorNextPagesDirectRoutePlan', () => {
  /** Connects `_app` and a finite dynamic-route value before full inventory enrichment. */
  it('creates a bounded app-wrapped plan with reached parameter evidence', async () => {
    const projectRoot = '/workspace/projects/front-office';
    const pagePath = `${projectRoot}/pages/hotels/[hotelName]/callTada.tsx`;
    const appPath = `${projectRoot}/pages/_app.tsx`;
    const guardPath = `${projectRoot}/lib/guard.ts`;
    const constantsPath = `${projectRoot}/lib/constants.ts`;
    const unrelatedPath = `${projectRoot}/pages/unrelated.tsx`;
    const fixture = createFixture({
      [pagePath]: [
        "import { guardPage } from '../../../lib/guard';",
        'export default function CallTada() { return <main>Call</main>; }',
        'export const getServerSideProps = guardPage();',
      ].join('\n'),
      [appPath]: [
        "import { QueryClientProvider } from '@tanstack/react-query';",
        'export default function App({ Component, pageProps }) {',
        '  return <QueryClientProvider><Component {...pageProps} /></QueryClientProvider>;',
        '}',
      ].join('\n'),
      [guardPath]: [
        "import { REGISTERED_HOTELS } from './constants';",
        'export const guardPage = () => async ({ query }) => {',
        '  const hotelName = query.hotelName;',
        '  if (!Object.keys(REGISTERED_HOTELS).includes(hotelName)) return { notFound: true };',
        '  return { props: { hotelName } };',
        '};',
      ].join('\n'),
      [constantsPath]: [
        'export const REGISTERED_HOTELS = {',
        '  testHotel: { name: "Test" },',
        '  secondHotel: { name: "Second" },',
        '};',
      ].join('\n'),
      [unrelatedPath]: 'export default function Unrelated() { return <main />; }',
    });

    const plan = await createPreviewInspectorNextPagesDirectRoutePlan({
      documentPath: pagePath,
      projectRoot,
      ...fixture,
      // The fast caller knows only the edited page. `_app` and parameter imports are reached
      // directly rather than supplied through a package inventory.
      sourcePaths: [pagePath],
      staticParameterSourceBoundary: projectRoot,
    });

    expect(plan?.pageCandidates).toHaveLength(1);
    expect(plan?.pageCandidates[0]).toMatchObject({
      id: `next-pages-direct:${pagePath}`,
      nextPagesShell: {
        app: { exportName: 'default', sourcePath: appPath },
        routeLocation: {
          evidenceKind: 'next-pages-filesystem',
          pathname: '/hotels/testHotel/callTada',
          pattern: '/hotels/[hotelName]/callTada',
        },
      },
      root: { exportName: 'default', sourcePath: pagePath },
    });
    expect(plan?.dependencyPaths).toEqual(
      expect.arrayContaining([pagePath, appPath, guardPath, constantsPath]),
    );
    expect(plan?.dependencyPaths).not.toContain(unrelatedPath);
  });

  /** Rejects API, special, unrelated, and shell-less folders that only resemble Next pages. */
  it('fails closed outside an authored Pages Router leaf', async () => {
    const projectRoot = '/workspace/project';
    const ordinaryPath = `${projectRoot}/src/components/pages/Card.tsx`;
    const apiPath = `${projectRoot}/pages/api/report.ts`;
    const appPath = `${projectRoot}/pages/_app.tsx`;
    const shellLessProjectRoot = '/workspace/shell-less';
    const shellLessPagePath = `${shellLessProjectRoot}/pages/report.tsx`;
    const fixture = createFixture({
      [ordinaryPath]: 'export default function Card() { return <div />; }',
      [apiPath]: 'export default function endpoint() {}',
      [appPath]: 'export default function App({ Component }) { return <Component />; }',
      [shellLessPagePath]: 'export default function Report() { return <main />; }',
    });

    expect(isPreviewInspectorNextPagesDirectRoutePath(apiPath, projectRoot)).toBe(false);
    expect(
      await createPreviewInspectorNextPagesDirectRoutePlan({
        documentPath: ordinaryPath,
        projectRoot,
        ...fixture,
        sourcePaths: [ordinaryPath],
      }),
    ).toBeUndefined();
    expect(
      await createPreviewInspectorNextPagesDirectRoutePlan({
        documentPath: shellLessPagePath,
        projectRoot: shellLessProjectRoot,
        ...fixture,
        sourcePaths: [shellLessPagePath],
      }),
    ).toBeUndefined();
  });
});
