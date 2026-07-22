/** Verifies bounded page-unit discovery behind a framework-owned Pages Router `_app`. */
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorNextPagesAppTargets } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextPagesAppTarget';

/** Creates an inert in-memory source reader for small route fixtures. */
function createSourceReader(
  sources: Readonly<Record<string, string>>,
): (sourcePath: string) => Promise<string | undefined> {
  return (sourcePath) => Promise.resolve(sources[sourcePath]);
}

describe('collectPreviewInspectorNextPagesAppTargets', () => {
  /** Keeps production pages ahead of a lexically earlier development-only route. */
  it('returns several lazy page units and deprioritizes dev routes', async () => {
    const appPath = '/workspace/apps/web/pages/_app.tsx';
    const devPath = '/workspace/apps/web/pages/dev/login/index.tsx';
    const signedPath = '/workspace/apps/web/pages/signed/index.tsx';
    const reportPath = '/workspace/apps/web/pages/driveReport/index.tsx';
    const sources = {
      [appPath]: 'export default function App({ Component }) { return <Component />; }',
      [devPath]: 'export default function LoginPage() { return <main />; }',
      [signedPath]: 'export default function SignedPage() { return <main />; }',
      [reportPath]: 'export default function ReportPage() { return <main />; }',
    };

    const targets = await collectPreviewInspectorNextPagesAppTargets({
      appPath,
      exportName: 'default',
      maximumCount: 2,
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(targets).toHaveLength(2);
    expect(
      targets.map((target) => (target.kind === 'authored-page' ? target.page.sourcePath : '')),
    ).toEqual([reportPath, signedPath]);
  });

  /** Reads only until the caller's page budget is satisfied. */
  it('does not inspect every leaf after reaching the requested maximum', async () => {
    const appPath = '/workspace/pages/_app.tsx';
    const pagePaths = ['/workspace/pages/a.tsx', '/workspace/pages/b.tsx'];
    const reads: string[] = [];

    const targets = await collectPreviewInspectorNextPagesAppTargets({
      appPath,
      exportName: 'default',
      maximumCount: 1,
      readSource: (sourcePath) => {
        reads.push(sourcePath);
        return Promise.resolve('export default function Page() { return <main />; }');
      },
      sourcePaths: [appPath, ...pagePaths],
    });

    expect(targets).toHaveLength(1);
    expect(reads).toEqual([pagePaths[0]]);
  });
});
