/** Verifies exact request-local resolution reuse without losing authored owners or alias identity. */
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';

const TARGET = '/workspace/src/view.tsx';
const CATALOG = '/workspace/src/catalog.ts';
const PAGE = '/workspace/src/Page.tsx';
const UNRELATED = '/workspace/src/Unrelated.tsx';
const OTHER_CATALOG = '/workspace/src/other-catalog.ts';
const OTHER_TARGET = '/workspace/src/other.tsx';

/** Mutable resolver boundary with an otherwise immutable authored source snapshot. */
interface ResolutionFixture {
  /** Exact consumer/specifier computation counts observed at the injected resolver port. */
  readonly calls: ReadonlyMap<string, number>;
  /** Production planner input shared by successive requests in freshness checks. */
  readonly options: Parameters<typeof createPreviewInspectorAncestorPlan>[0];
  /** Changes only the next request's alias resolution, without rewriting any authored source. */
  readonly retargetCatalog: () => void;
}

/** Keeps resolver call counts separate from the independent exact import-identity predicate. */
function createFixture(): ResolutionFixture {
  const sources: Record<string, string> = {
    [TARGET]: 'export default function SelectedView() { return <main />; }',
    [CATALOG]: 'export { default as Panel } from "@visual";',
    [PAGE]: [
      'import { Panel } from "@catalog";',
      'export function Page() { return <Provider><Panel /></Provider>; }',
    ].join('\n'),
    [UNRELATED]: [
      'import Unused from "@missing";',
      'export function Unrelated() { return <Unused />; }',
    ].join('\n'),
    [OTHER_CATALOG]: 'export { default as OtherPanel } from "@visual";',
    [OTHER_TARGET]: 'export default function OtherView() { return <aside />; }',
    '/workspace/src/main.tsx': [
      'import { createRoot } from "react-dom/client";',
      'import { Page } from "@page";',
      'createRoot(document.getElementById("root")).render(<Page />);',
    ].join('\n'),
  };
  const calls = new Map<string, number>();
  let selectedCatalogTarget = TARGET;
  const resolve = (specifier: string, consumer: string): string | undefined => {
    if (specifier === '@visual') {
      return consumer === OTHER_CATALOG ? OTHER_TARGET : selectedCatalogTarget;
    }
    if (specifier === '@catalog') return CATALOG;
    if (specifier === '@page') return PAGE;
    return undefined;
  };
  return {
    calls,
    retargetCatalog(): void {
      selectedCatalogTarget = OTHER_TARGET;
    },
    options: {
      documentPath: TARGET,
      exportName: 'default',
      matchesTargetImport: (specifier: string, consumer: string, target: string): boolean =>
        resolve(specifier, consumer) === target,
      readSource: (sourcePath: string): Promise<string | undefined> =>
        Promise.resolve(sources[sourcePath]),
      resolveModule: (specifier: string, consumer: string): string | undefined => {
        const key = JSON.stringify([consumer, specifier]);
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return resolve(specifier, consumer);
      },
      sourcePaths: Object.keys(sources),
    },
  };
}

describe('AncestorPlan exact request-local resolution reuse', () => {
  it('keeps the authored page reached through an opaque re-export while resolving each tuple once', async () => {
    const fixture = createFixture();
    const plan = await createPreviewInspectorAncestorPlan(fixture.options);

    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE });
    expect(plan.target).toEqual({ exportName: 'default', sourcePath: TARGET });
    expect(plan.dependencyPaths).toEqual(expect.arrayContaining([TARGET, CATALOG, PAGE]));
    expect(fixture.calls.size).toBeGreaterThan(0);
    expect([...fixture.calls.values()]).toEqual([...fixture.calls.values()].map(() => 1));
  });

  it('reuses an unresolved import only within the current source snapshot', async () => {
    const fixture = createFixture();
    await createPreviewInspectorAncestorPlan(fixture.options);
    const key = JSON.stringify([UNRELATED, '@missing']);
    expect(fixture.calls.get(key)).toBe(1);
    await createPreviewInspectorAncestorPlan(fixture.options);
    expect(fixture.calls.get(key)).toBe(2);
  });

  it('keeps identical specifiers from different consumers independent', async () => {
    const fixture = createFixture();
    const plan = await createPreviewInspectorAncestorPlan(fixture.options);
    expect(plan.root).toEqual({ exportName: 'Page', sourcePath: PAGE });
    expect(fixture.calls.get(JSON.stringify([CATALOG, '@visual']))).toBe(1);
    expect(fixture.calls.get(JSON.stringify([OTHER_CATALOG, '@visual']))).toBe(1);
  });

  it('re-resolves a previously successful alias when a later request points it elsewhere', async () => {
    const fixture = createFixture();
    const first = await createPreviewInspectorAncestorPlan(fixture.options);
    fixture.retargetCatalog();
    const next = await createPreviewInspectorAncestorPlan(fixture.options);
    expect(first.root).toEqual({ exportName: 'Page', sourcePath: PAGE });
    expect(next.root).toEqual({ exportName: 'default', sourcePath: TARGET });
  });
});
