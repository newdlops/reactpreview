/** Verifies bounded cross-module DFS for selected-file JSX return outcomes. */
import { describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorRenderOutcomes,
  PREVIEW_INSPECTOR_RENDER_OUTCOME_EXPANSION_LIMITS,
  type CollectedPreviewInspectorRenderOutcomes,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRenderOutcomeExpansion';

/** Creates an immutable in-memory source reader used by syntax-only graph fixtures. */
function createSourceReader(
  sources: Readonly<Record<string, string>>,
): (sourcePath: string) => Promise<string | undefined> {
  return (sourcePath) => Promise.resolve(sources[sourcePath]);
}

/** Returns all fixtures through the ordinary lexical relative-import resolver. */
async function collectFixtureOutcomes(
  targetPath: string,
  sources: Readonly<Record<string, string>>,
): Promise<CollectedPreviewInspectorRenderOutcomes> {
  return collectPreviewInspectorRenderOutcomes({
    acceptedExportNames: ['Target'],
    readSource: createSourceReader(sources),
    sourcePath: targetPath,
    sourcePaths: Object.keys(sources),
  });
}

describe('collectPreviewInspectorRenderOutcomes', () => {
  /** Keeps a layout shell and passed body together while recursively resolving their imports. */
  it('expands imported layout and child implementations with source provenance', async () => {
    const targetPath = '/workspace/src/Target.tsx';
    const layoutPath = '/workspace/src/PageLayout.tsx';
    const headerPath = '/workspace/src/Header.tsx';
    const sidebarPath = '/workspace/src/Sidebar.tsx';
    const bodyPath = '/workspace/src/TargetBody.tsx';
    const actionPath = '/workspace/src/ActionButton.tsx';
    const sources = {
      [targetPath]: [
        "import { PageLayout } from './PageLayout';",
        "import TargetBody from './TargetBody';",
        'export function Target() {',
        '  return <PageLayout><TargetBody /></PageLayout>;',
        '}',
      ].join('\n'),
      [layoutPath]: [
        "import Header from './Header';",
        "import { Sidebar } from './Sidebar';",
        'export function PageLayout({ children }) {',
        '  return <main><Header /><Sidebar />{children}</main>;',
        '}',
      ].join('\n'),
      [headerPath]: 'export default function Header() { return <header />; }',
      [sidebarPath]: 'export function Sidebar() { return <aside />; }',
      [bodyPath]: [
        "import { ActionButton } from './ActionButton';",
        'export default function TargetBody() { return <section><ActionButton /></section>; }',
      ].join('\n'),
      [actionPath]: 'export function ActionButton() { return <button />; }',
    };

    const result = await collectFixtureOutcomes(targetPath, sources);
    const outcome = result.plansByExport.Target?.outcomes[0];

    expect(outcome?.componentTree).toMatchObject([
      {
        name: 'PageLayout',
        sourcePath: targetPath,
        children: [
          { children: [], name: 'Header', sourcePath: layoutPath },
          { children: [], name: 'Sidebar', sourcePath: layoutPath },
          {
            name: 'TargetBody',
            sourcePath: targetPath,
            children: [{ children: [], name: 'ActionButton', sourcePath: bodyPath }],
          },
        ],
      },
    ]);
    expect(outcome?.componentNames).toEqual([
      'PageLayout',
      'Header',
      'Sidebar',
      'TargetBody',
      'ActionButton',
    ]);
    expect(result.dependencyPaths).toEqual(Object.keys(sources).sort());
    expect(Object.isFrozen(outcome?.componentTree)).toBe(true);
    expect(Object.isFrozen(outcome?.componentTree[0]?.children)).toBe(true);
  });

  /** Reserves the selected body before a large layout shell consumes the remaining node budget. */
  it('preserves authored children when an implementation reaches the node limit', async () => {
    const targetPath = '/workspace/src/Target.tsx';
    const layoutPath = '/workspace/src/PageLayout.tsx';
    const bodyPath = '/workspace/src/TargetBody.tsx';
    const cases = Array.from({ length: 4 }, (_, caseIndex) => {
      const components = Array.from(
        { length: 30 },
        (_, componentIndex) => `<Shell${String(caseIndex)}Component${String(componentIndex)} />`,
      ).join('');
      return `case ${String(caseIndex)}: return <>${components}</>;`;
    }).join('\n');
    const sources = {
      [targetPath]: [
        "import { PageLayout } from './PageLayout';",
        "import TargetBody from './TargetBody';",
        'export function Target() { return <PageLayout><TargetBody /></PageLayout>; }',
      ].join('\n'),
      [layoutPath]: `export function PageLayout({ mode }) { switch (mode) { ${cases} } }`,
      [bodyPath]: [
        'function TargetMarker() { return <strong />; }',
        'export default function TargetBody() { return <TargetMarker />; }',
      ].join('\n'),
    };

    const result = await collectFixtureOutcomes(targetPath, sources);
    const plan = result.plansByExport.Target;
    const layoutChildren = plan?.outcomes[0]?.componentTree[0]?.children;
    const selectedBody = layoutChildren?.at(-1);

    expect(plan?.truncated).toBe(true);
    expect(selectedBody).toMatchObject({
      name: 'TargetBody',
      children: [{ name: 'TargetMarker', sourcePath: bodyPath }],
      sourcePath: targetPath,
    });
  });

  /** Crosses a named barrel and a lazy default import without executing either wrapper. */
  it('resolves barrel exports and lazy imports while stopping recursive component cycles', async () => {
    const targetPath = '/workspace/src/Target.tsx';
    const barrelPath = '/workspace/src/components/index.ts';
    const loopPath = '/workspace/src/components/Loop.tsx';
    const lazyPath = '/workspace/src/LazyPanel.tsx';
    const sources = {
      [targetPath]: [
        "import { Loop } from './components';",
        "const LazyPanel = React.lazy(() => import('./LazyPanel'));",
        'export function Target() { return <Loop><LazyPanel /></Loop>; }',
      ].join('\n'),
      [barrelPath]: "export { Loop } from './Loop';",
      [loopPath]: 'export function Loop({ children }) { return <div><Loop />{children}</div>; }',
      [lazyPath]: 'export default function LazyPanel() { return <article />; }',
    };

    const result = await collectFixtureOutcomes(targetPath, sources);
    const root = result.plansByExport.Target?.outcomes[0]?.componentTree[0];

    expect(root).toMatchObject({
      name: 'Loop',
      children: [
        { children: [], name: 'Loop', sourcePath: loopPath },
        { children: [], name: 'LazyPanel', sourcePath: targetPath },
      ],
    });
    expect(result.dependencyPaths).toEqual([barrelPath, lazyPath, loopPath, targetPath].sort());
    expect(result.plansByExport.Target?.truncated).toBe(false);
  });

  /** Marks a deep implementation chain as truncated instead of reading/rendering without bound. */
  it('enforces deterministic DFS depth limits and preserves the reachable prefix', async () => {
    const targetPath = '/workspace/src/Target.tsx';
    const sources: Record<string, string> = {
      [targetPath]: "import { C0 } from './C0'; export function Target() { return <C0 />; }",
    };
    for (
      let index = 0;
      index < PREVIEW_INSPECTOR_RENDER_OUTCOME_EXPANSION_LIMITS.depth + 3;
      index += 1
    ) {
      const nextIndex = index + 1;
      const indexText = String(index);
      const nextIndexText = String(nextIndex);
      sources[`/workspace/src/C${indexText}.tsx`] =
        index === PREVIEW_INSPECTOR_RENDER_OUTCOME_EXPANSION_LIMITS.depth + 2
          ? `export function C${indexText}() { return <div />; }`
          : `import { C${nextIndexText} } from './C${nextIndexText}'; export function C${indexText}() { return <C${nextIndexText} />; }`;
    }

    const first = await collectFixtureOutcomes(targetPath, sources);
    const second = await collectFixtureOutcomes(targetPath, sources);
    const firstPlan = first.plansByExport.Target;

    expect(firstPlan?.truncated).toBe(true);
    expect(first).toEqual(second);
    expect(firstPlan?.outcomes[0]?.componentNames).toEqual([
      'C0',
      'C1',
      'C2',
      'C3',
      'C4',
      'C5',
      'C6',
      'C7',
    ]);
  });

  /** Leaves unresolved external values as stable leaves rather than inventing implementations. */
  it('fails closed for unresolved component modules', async () => {
    const targetPath = '/workspace/src/Target.tsx';
    const sources = {
      [targetPath]: [
        "import { RemotePanel } from '@unknown/components';",
        'export function Target() { return <RemotePanel />; }',
      ].join('\n'),
    };

    const result = await collectFixtureOutcomes(targetPath, sources);

    expect(result.plansByExport.Target?.outcomes[0]?.componentTree).toMatchObject([
      { children: [], name: 'RemotePanel', sourcePath: targetPath },
    ]);
    expect(result.dependencyPaths).toEqual([targetPath]);
    expect(result.plansByExport.Target?.truncated).toBe(false);
  });
});
