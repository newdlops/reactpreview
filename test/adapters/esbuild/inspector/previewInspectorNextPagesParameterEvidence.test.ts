/** Verifies static-record recovery for finite Next.js Pages Router dynamic segments. */
import { describe, expect, it } from 'vitest';
import { refinePreviewInspectorNextPagesShell } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextPagesParameterEvidence';
import { collectPreviewInspectorNextPagesShell } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextPagesShell';

/** Creates an immutable source reader for one small route dependency graph. */
function createSourceReader(
  sources: Readonly<Record<string, string>>,
): (sourcePath: string) => Promise<string | undefined> {
  return (sourcePath) => Promise.resolve(sources[sourcePath]);
}

describe('refinePreviewInspectorNextPagesShell', () => {
  /** Uses a server-side membership guard's first authored record key for the dynamic segment. */
  it('materializes a dynamic route value proven by an imported static registry', async () => {
    const pagePath = '/workspace/projects/web/pages/hotels/[hotelName]/callTada.tsx';
    const appPath = '/workspace/projects/web/pages/_app.tsx';
    const guardPath = '/workspace/projects/web/lib/guard.ts';
    const constantsPath = '/workspace/projects/web/lib/constants.ts';
    const sources = {
      [pagePath]: [
        "import { guardPage } from '../../../lib/guard';",
        'export default function Page({ hotelName }) { return <main>{hotelName}</main>; }',
        'export const getServerSideProps = guardPage();',
      ].join('\n'),
      [appPath]: 'export default function App({ Component }) { return <Component />; }',
      [guardPath]: [
        "import { REGISTERED_HOTELS } from './constants';",
        'export const guardPage = () => async ({ query }) => {',
        '  const hotelName = query.hotelName as string;',
        '  if (!Object.keys(REGISTERED_HOTELS).includes(hotelName)) return { notFound: true };',
        '  return { props: { hotelName } };',
        '};',
      ].join('\n'),
      [constantsPath]: [
        'export const REGISTERED_HOTELS = Object.freeze({',
        '  testHotel: { name: "Test" },',
        '  secondHotel: { name: "Second" },',
        '});',
      ].join('\n'),
    };
    const shell = collectPreviewInspectorNextPagesShell({
      exportName: 'default',
      pagePath,
      sourcePaths: Object.keys(sources),
    });
    expect(shell).toBeDefined();
    if (shell === undefined) throw new Error('Expected an authored Next Pages shell.');

    const refined = await refinePreviewInspectorNextPagesShell({
      readSource: createSourceReader(sources),
      shell,
      sourcePaths: Object.keys(sources),
    });

    expect(refined.shell.routeLocation).toMatchObject({
      pathname: '/hotels/testHotel/callTada',
      pattern: '/hotels/[hotelName]/callTada',
    });
    expect(refined.dependencyPaths).toEqual([constantsPath, guardPath].sort());
  });

  /** Keeps the visible parameter-name fallback when no finite record can be proven. */
  it('fails closed for computed registries and unrelated parameter values', async () => {
    const pagePath = '/workspace/projects/web/pages/company/[companyId].tsx';
    const appPath = '/workspace/projects/web/pages/_app.tsx';
    const sources = {
      [pagePath]: [
        'const records = createRecords();',
        'export default function Page({ companyId }) { return <main>{records[companyId]}</main>; }',
      ].join('\n'),
      [appPath]: 'export default function App({ Component }) { return <Component />; }',
    };
    const shell = collectPreviewInspectorNextPagesShell({
      exportName: 'default',
      pagePath,
      sourcePaths: Object.keys(sources),
    });
    expect(shell).toBeDefined();
    if (shell === undefined) throw new Error('Expected an authored Next Pages shell.');

    const refined = await refinePreviewInspectorNextPagesShell({
      readSource: createSourceReader(sources),
      shell,
      sourcePaths: Object.keys(sources),
    });

    expect(refined.shell).toBe(shell);
    expect(refined.shell.routeLocation.pathname).toBe('/company/companyId');
    expect(refined.dependencyPaths).toEqual([]);
  });
});
