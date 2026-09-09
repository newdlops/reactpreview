/** Exercises a leaf route with authored sibling chrome through compilation and real Chromium. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { PreviewCompilerWorkerClient } from '../../../src/adapters/worker/previewCompilerWorkerClient';
import { renderPreviewHeadlessly } from '../../../src/adapters/node/previewHeadlessRenderer';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('authored page frame in Chromium', () => {
  it.each([false, true])(
    'renders the page without inactive routes or missing shell props (dense: %s)',
    async (dense) => {
      const fixtureRoot = await mkdtemp(path.join(PROJECT_ROOT, 'test/fixtures/page-frame-'));
      const compiler =
        process.env.REACT_PREVIEW_TEST_WORKER === undefined
          ? new EsbuildPreviewCompiler()
          : new PreviewCompilerWorkerClient(path.resolve(process.env.REACT_PREVIEW_TEST_WORKER), {
              bundledNodeModulesPath: path.join(PROJECT_ROOT, 'dist/node_modules'),
            });
      try {
        const routerRoot = path.join(fixtureRoot, 'node_modules/react-router-dom');
        await mkdir(routerRoot, { recursive: true });
        const sourceText =
          'export default function Target() { return <main id="frame-target">FRAME_TARGET</main>; }';
        const sources = {
          'package.json': '{"private":true}',
          'Target.tsx': sourceText,
          'ViewItems.tsx':
            'import Target from "./Target"; export default function ViewItems() { return <Target />; }',
          'Header.tsx': dense
            ? 'export default function Header({ record }: { record: { fullName: string } }) { return <header id="frame-header">FRAME_HEADER: {record.fullName}</header>; }'
            : 'export default function Header() { return <header id="frame-header">FRAME_HEADER</header>; }',
          'Footer.tsx':
            'export default function Footer() { return <footer id="frame-footer">FRAME_FOOTER</footer>; }',
          'App.tsx': dense
            ? [
                'import { BrowserRouter, Route, Switch, withRouter } from "react-router-dom";',
                'import ViewItems from "./ViewItems"; import Header from "./Header"; import Footer from "./Footer";',
                'import Permissions from "./Permissions"; import OtherTab from "./OtherTab";',
                'const Tab = () => <button>Tab</button>;',
                'const App = () => { const allowed = [Permissions.ReadRecords].includes(Permissions.ReadRecords);',
                'return <><Header /><BrowserRouter><nav>',
                '<Tab />'.repeat(40),
                '</nav><Switch><Route path="/other"><OtherTab /></Route>',
                '<Route path="/items"><ViewItems /></Route></Switch></BrowserRouter><Footer /></>; };',
                'export default withRouter(App);',
              ].join('\n')
            : [
                'import { BrowserRouter, Route, Switch } from "react-router-dom";',
                'import ViewItems from "./ViewItems";',
                'import Header from "./Header";',
                'import Footer from "./Footer";',
                'export default function App() { return <BrowserRouter><Header /><Switch>',
                '<Route path="/items"><ViewItems /></Route>',
                '</Switch><Footer /></BrowserRouter>; }',
              ].join('\n'),
          'Permissions.ts':
            'enum Permissions { ReadRecords = "read-records" }; export default Permissions;',
          'OtherTab.tsx':
            'throw new Error("INACTIVE_ROUTE_EXECUTED"); export default function OtherTab() { return <main>WRONG_ROUTE</main>; }',
          'main.tsx':
            'import { createRoot } from "react-dom/client"; import App from "./App"; createRoot(document.getElementById("root")).render(<App />);',
          // A deterministic fixture-owned v5-shaped location adapter; no project server or dependency download.
          'node_modules/react-router-dom/package.json':
            '{"name":"react-router-dom","version":"5.0.0","type":"module","main":"index.js"}',
          'node_modules/react-router-dom/index.js': [
            'export function MemoryRouter({ children }) { return children; }',
            'export const BrowserRouter = MemoryRouter;',
            'export const withRouter = (Component) => Component;',
            'export function Switch({ children }) { return children; }',
            'export function Route({ children, render, component: Component }) {',
            '  return render ? render({}) : Component ? Component({}) : children;',
            '}',
            'export const useLocation = () => ({ pathname: "/items", search: "", hash: "" });',
            'export const useParams = () => ({});',
          ].join('\n'),
        };
        await Promise.all(
          Object.entries(sources).map(([relativePath, source]) =>
            writeFile(path.join(fixtureRoot, relativePath), source, 'utf8'),
          ),
        );
        const result = await renderPreviewHeadlessly(
          compiler,
          {
            dependencySnapshots: [],
            documentPath: path.join(fixtureRoot, 'Target.tsx'),
            language: 'tsx',
            preparationMode: 'fast',
            renderMode: 'page-inspector',
            sourceText,
            useStorybookPreview: false,
            workspaceRoot: fixtureRoot,
          },
          process.env.CHROMIUM_PATH === undefined
            ? {}
            : { chromiumPath: process.env.CHROMIUM_PATH },
        );
        expect(result.status, result.protocolError ?? result.timeoutDiagnostic).toBe('ready');
        for (const marker of ['header', 'target', 'footer']) {
          expect(
            result.rootHtml.match(new RegExp(`id="frame-${marker}"`, 'gu')),
            JSON.stringify(result.stabilization?.compositionSnapshot),
          ).toHaveLength(1);
        }
        expect(result.rootHtml.indexOf('id="frame-header"')).toBeLessThan(
          result.rootHtml.indexOf('id="frame-target"'),
        );
        expect(result.rootHtml.indexOf('id="frame-target"')).toBeLessThan(
          result.rootHtml.indexOf('id="frame-footer"'),
        );
        expect(result.evidence.requiredArtifactFailures ?? []).toEqual([]);
        expect(result.evidence.cdpExceptions ?? []).toEqual([]);
        expect(result.evidence.windowErrors).toEqual([]);
        expect(result.rootHtml).not.toContain('WRONG_ROUTE');
        expect(result.rootHtml).not.toContain('INACTIVE_ROUTE_EXECUTED');
        expect(result.stabilization?.compositionSnapshot).toMatchObject({
          targetHasOutput: true,
          targetPageRootCommitted: true,
          targetStatus: 'reached',
        });
        expect(result.cleanup).toEqual({
          browserTerminated: true,
          profileRemoved: true,
          serverClosed: true,
        });
      } finally {
        await compiler.shutdown();
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
