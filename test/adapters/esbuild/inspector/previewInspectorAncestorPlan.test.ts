/** Verifies bounded real-owner discovery for the Page Inspector mount mode. */
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector';

const TARGET_PATH = '/workspace/packages/application/src/Target.tsx';
const CARD_PATH = '/workspace/packages/application/src/Card.tsx';
const PAGE_PATH = '/workspace/packages/application/src/Page.tsx';
const APP_PATH = '/workspace/packages/application/src/App.tsx';

/** Creates a snapshot-aware source callback over a small immutable fixture graph. */
function createSourceReader(
  sources: Readonly<Record<string, string>>,
): (sourcePath: string) => Promise<string | undefined> {
  return (sourcePath) => Promise.resolve(sources[sourcePath]);
}

describe('createPreviewInspectorAncestorPlan', () => {
  /** Mounts the outer real App so its page siblings and all nested target children remain active. */
  it('crosses exported and private owners to the actual package root', async () => {
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <article />;',
      [CARD_PATH]: [
        "import { Target } from './Target';",
        'export function Card() {',
        '  return <section><aside /><Target tone="warm" /><footer /></section>;',
        '}',
      ].join('\n'),
      [PAGE_PATH]: [
        "import { Card } from './Card';",
        'const Body = () => <main><Card visible /></main>;',
        'export default function Page() {',
        '  return <div><nav /><Body /><footer /></div>;',
        '}',
      ].join('\n'),
      [APP_PATH]: [
        "import Page from './Page';",
        'export const App = () => <div><header /><Page /><aside /></div>;',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: [PAGE_PATH, TARGET_PATH, APP_PATH, CARD_PATH],
    });

    expect(plan.complete).toBe(true);
    expect(plan.stopReason).toBe('root-reached');
    expect(plan.root).toEqual({ exportName: 'App', sourcePath: APP_PATH });
    expect(plan.targetAutomaticProps).toEqual({ tone: 'warm' });
    expect(plan.dependencyPaths).toEqual([APP_PATH, CARD_PATH, PAGE_PATH, TARGET_PATH]);
    expect(plan.edges).toMatchObject([
      {
        child: { exportName: 'Target', sourcePath: TARGET_PATH },
        childAutomaticProps: { tone: 'warm' },
        localOwnerDepth: 0,
        owner: { exportName: 'Card', sourcePath: CARD_PATH },
      },
      {
        child: { exportName: 'Card', sourcePath: CARD_PATH },
        childAutomaticProps: { visible: true },
        localOwnerDepth: 1,
        localOwnerNames: ['Body'],
        owner: { exportName: 'default', sourcePath: PAGE_PATH },
      },
      {
        child: { exportName: 'default', sourcePath: PAGE_PATH },
        childAutomaticProps: {},
        localOwnerDepth: 0,
        owner: { exportName: 'App', sourcePath: APP_PATH },
      },
    ]);
  });

  /** Dynamic project wrappers remain part of the real owner instead of blocking inspector ancestry. */
  it('traverses an owner even when pinpoint wrapper reconstruction is unsafe', async () => {
    const sources = {
      [TARGET_PATH]: 'export default function Target() { return <span />; }',
      [PAGE_PATH]: [
        "import Target from './Target';",
        "import { Form } from './Form';",
        'export function Page({ values }) {',
        '  return <Form initialValues={values}><Target enabled={false} /></Form>;',
        '}',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'default',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(true);
    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE_PATH });
    expect(plan.targetAutomaticProps).toEqual({ enabled: false });
    expect(plan.edges).toHaveLength(1);
  });

  /** Retains the last importable child and its observed props when the outer owner is private. */
  it('fails closed at an unexported terminal owner', async () => {
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <div />;',
      [CARD_PATH]: [
        "import { Target } from './Target';",
        'const PrivateCard = () => <section><Target count={3} /></section>;',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(false);
    expect(plan.stopReason).toBe('private-owner');
    expect(plan.root).toEqual({ exportName: 'Target', sourcePath: TARGET_PATH });
    expect(plan.rootAutomaticProps).toEqual({ count: 3 });
    expect(plan.edges).toEqual([]);
  });

  /** Accepts a caller-proven monorepo package alias that lexical path suffixes cannot resolve. */
  it('uses project-aware accepted specifiers for a scoped workspace import', async () => {
    const monorepoTarget = '/workspace/packages/ui/src/components/Target.tsx';
    const monorepoPage = '/workspace/apps/web/src/Page.tsx';
    const sources = {
      [monorepoTarget]: 'export const Target = () => <div />;',
      [monorepoPage]: [
        "import { Target } from '@acme/ui-target';",
        'export default function Page() { return <Target />; }',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      acceptedImportSpecifiers: (reference) =>
        reference.sourcePath === monorepoTarget ? ['@acme/ui-target'] : [],
      documentPath: monorepoTarget,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.root).toEqual({ exportName: 'default', sourcePath: monorepoPage });
    expect(plan.edges).toHaveLength(1);
  });

  /** Treats an application entry render call as evidence that the current export is the page root. */
  it('stops successfully at a top-level React render usage', async () => {
    const entryPath = '/workspace/packages/application/src/main.tsx';
    const sources = {
      [TARGET_PATH]: 'export function App() { return <main />; }',
      [entryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import { App } from './Target';",
        'createRoot(document.getElementById(\'root\')).render(<App locale="ko" />);',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'App',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(true);
    expect(plan.stopReason).toBe('root-reached');
    expect(plan.root).toEqual({ exportName: 'App', sourcePath: TARGET_PATH });
    expect(plan.rootAutomaticProps).toEqual({ locale: 'ko' });
    expect(plan.renderChain.reachability).toBe('entry-connected');
    expect(plan.renderChain.paths[0]?.entryPoint).toMatchObject({
      kind: 'create-root',
      sourcePath: entryPath,
    });
    expect(plan.dependencyPaths).toContain(entryPath);
  });

  /** Keeps the last component root when an exported React Router configuration owns its JSX use. */
  it('does not promote route arrays or router objects as React component roots', async () => {
    const routesPath = '/workspace/packages/application/src/routes.tsx';
    const sources = {
      [TARGET_PATH]: 'export function Target() { return <button />; }',
      [PAGE_PATH]: [
        "import { Target } from './Target';",
        'export function Page() { return <main><Target /></main>; }',
      ].join('\n'),
      [routesPath]: [
        "import { Page } from './Page';",
        'export const routes = [{ path: "/dashboard", element: <Page locale="ko" /> }];',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(false);
    expect(plan.stopReason).toBe('non-component-owner');
    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE_PATH });
    expect(plan.rootAutomaticProps).toEqual({ locale: 'ko' });
    expect(plan.edges).toHaveLength(1);
    expect(plan.dependencyPaths).toEqual([PAGE_PATH, TARGET_PATH, routesPath].sort());
  });

  /** Prefers an application page branch over an earlier lexical story/test usage. */
  it('ranks page ancestry ahead of tests, stories, and examples deterministically', async () => {
    const testPath = '/workspace/packages/application/src/__tests__/Target.test.tsx';
    const dashboardPath = '/workspace/packages/application/src/pages/DashboardPage.tsx';
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <span />;',
      [testPath]: [
        "import { Target } from '../Target';",
        'export const TestHarness = () => <Target branch="test" />;',
      ].join('\n'),
      [dashboardPath]: [
        "import { Target } from '../Target';",
        'export const DashboardPage = () => <main><Target branch="page" /></main>;',
      ].join('\n'),
      [APP_PATH]: [
        "import { DashboardPage } from './pages/DashboardPage';",
        'export const App = () => <DashboardPage />;',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: [testPath, TARGET_PATH, dashboardPath, APP_PATH],
    });

    expect(plan.root).toEqual({ exportName: 'App', sourcePath: APP_PATH });
    expect(plan.targetAutomaticProps).toEqual({ branch: 'page' });
    expect(plan.edges[0]?.owner).toEqual({
      exportName: 'DashboardPage',
      sourcePath: dashboardPath,
    });
    expect(plan.dependencyPaths).not.toContain(testPath);
  });

  /** Retains component factories when the selected JSX lies in a bounded HOC function argument. */
  it('accepts function-shaped memo and observer owners', async () => {
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <span />;',
      [PAGE_PATH]: [
        "import { memo } from 'react';",
        "import { Target } from './Target';",
        'export const Page = memo(() => <main><Target /></main>);',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(true);
    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE_PATH });
    expect(plan.edges).toHaveLength(1);
  });

  /** Promotes an inline component wrapped by the tagged-template styled-components factory. */
  it('accepts a styled-components tagged-template owner', async () => {
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <span />;',
      [PAGE_PATH]: [
        "import styled from 'styled-components';",
        "import { Target } from './Target';",
        'export const Page = styled((props) => (',
        '  <main><Target {...props} /><aside>authored sibling</aside></main>',
        '))`min-height: 100vh;`;',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(true);
    expect(plan.stopReason).toBe('root-reached');
    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE_PATH });
    expect(plan.edges).toHaveLength(1);
  });

  /** Keeps arbitrary tagged-template factories with inline JSX out of the React owner graph. */
  it('rejects a non-styled tagged-template factory containing target JSX', async () => {
    const metadataPath = '/workspace/packages/application/src/metadata.tsx';
    const sources = {
      [TARGET_PATH]: 'export const Target = () => <span />;',
      [metadataPath]: [
        "import { Target } from './Target';",
        'const metadataFactory = (render) => (parts) => ({ parts, render });',
        'export const Metadata = metadataFactory(() => (',
        '  <Target tone="metadata" />',
        '))`non-react metadata`;',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.complete).toBe(false);
    expect(plan.stopReason).toBe('non-component-owner');
    expect(plan.root).toEqual({ exportName: 'Target', sourcePath: TARGET_PATH });
    expect(plan.rootAutomaticProps).toEqual({ tone: 'metadata' });
    expect(plan.edges).toEqual([]);
  });

  /** Crosses named and wildcard barrel exports while keeping them out of the React owner path. */
  it('discovers the real page through a bounded barrel re-export chain', async () => {
    const firstBarrelPath = '/workspace/packages/application/src/components/index.ts';
    const secondBarrelPath = '/workspace/packages/application/src/ui.ts';
    const sources = {
      [TARGET_PATH]: 'export function Target() { return <button />; }',
      [firstBarrelPath]: "export { Target } from '../Target';",
      [secondBarrelPath]: "export * from './components';",
      [PAGE_PATH]: [
        "import { Target } from './ui';",
        'export function Page() { return <main><Target label="barrel" /></main>; }',
      ].join('\n'),
    };

    const plan = await createPreviewInspectorAncestorPlan({
      documentPath: TARGET_PATH,
      exportName: 'Target',
      readSource: createSourceReader(sources),
      sourcePaths: Object.keys(sources),
    });

    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE_PATH });
    expect(plan.targetAutomaticProps).toEqual({ label: 'barrel' });
    expect(plan.dependencyPaths).toEqual(
      [firstBarrelPath, PAGE_PATH, secondBarrelPath, TARGET_PATH].sort(),
    );
    expect(plan.edges).toHaveLength(1);
  });
});
