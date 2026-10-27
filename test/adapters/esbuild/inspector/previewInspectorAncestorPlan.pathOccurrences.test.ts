/** Keeps same-parent JSX occurrences and deeper diamond paths independently executable. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

const ROOT = '/workspace/path-occurrences';
const TARGET = `${ROOT}/Sparkle.tsx`;
const PAGE = `${ROOT}/Page.tsx`;
const ENTRY = `${ROOT}/entry.tsx`;

/** Analyzes only immutable in-memory sources; no fixture module is imported or evaluated. */
function createPlan(
  sources: Readonly<Record<string, string>>,
  paths?: readonly PreviewRenderChainCandidate[],
): ReturnType<typeof createPreviewInspectorAncestorPlan> {
  return createPreviewInspectorAncestorPlan({
    documentPath: TARGET,
    exportName: 'Sparkle',
    readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
    resolveModule: (specifier, importer) => {
      if (!specifier.startsWith('.')) return undefined;
      const stem = path.resolve(path.dirname(importer), specifier);
      return ['', '.tsx', '.ts'].map((suffix) => stem + suffix).find((file) => file in sources);
    },
    sourcePaths: Object.keys(sources),
    ...(paths === undefined
      ? {}
      : {
          renderChainsByExport: {
            Sparkle: {
              dependencyPaths: Object.keys(sources),
              paths,
              reachability: 'entry-connected' as const,
              target: { exportName: 'Sparkle', sourcePath: TARGET },
              truncated: false,
            },
          },
        }),
  });
}

describe('ancestor caller-path occurrence identity', () => {
  it('retains both JSX uses beneath the same page export with their own exact props', async () => {
    const page = [
      'import { Sparkle } from "./Sparkle";',
      'export function Page({ alternate }) {',
      '  return alternate',
      '    ? <section><Sparkle tone="first" /></section>',
      '    : <aside><Sparkle tone="second" /></aside>;',
      '}',
    ].join('\n');
    const plan = await createPlan({
      [TARGET]: 'export function Sparkle({ tone }) { return <span>{tone}</span>; }',
      [PAGE]: page,
      [ENTRY]:
        'import { createRoot } from "react-dom/client"; import { Page } from "./Page"; createRoot(document.body).render(<Page />);',
    });
    const paths = plan.renderChain.paths;
    expect(paths).toHaveLength(2);
    expect(new Set(plan.pageCandidates.map((candidate) => candidate.renderPath?.id))).toEqual(
      new Set(paths.map((candidate) => candidate.id)),
    );
    const expectedPositions = [page.indexOf('<Sparkle'), page.lastIndexOf('<Sparkle')];
    expect(
      new Set(
        plan.pageCandidates
          .flatMap((candidate) =>
            candidate.edges.map((edge) =>
              edge.child.sourcePath === TARGET ? edge.occurrenceStart : undefined,
            ),
          )
          .filter((position) => position !== undefined),
      ),
    ).toEqual(new Set(expectedPositions));
    for (const candidate of plan.pageCandidates) {
      const step = candidate.renderPath?.steps[0];
      const edge = candidate.edges.find((item) => item.child.sourcePath === TARGET);
      expect((edge?.occurrenceStart ?? -2) + 1).toBe(step?.occurrenceStart);
      expect(candidate.targetAutomaticProps).toMatchObject({
        tone: step?.occurrenceStart === (expectedPositions[0] ?? -2) + 1 ? 'first' : 'second',
      });
    }
  });

  it('keeps the complete outer page for direct and nested consumers on the same corridor', async () => {
    const loading = `${ROOT}/Loading.tsx`;
    const finish = `${ROOT}/Finish.tsx`;
    const flow = `${ROOT}/Flow.tsx`;
    const sources: Readonly<Record<string, string>> = {
      [TARGET]: 'export function Sparkle() { return <span>stars</span>; }',
      [loading]:
        'import { Sparkle } from "./Sparkle"; export function Loading() { return <main><Sparkle /></main>; }',
      [finish]:
        'import { Loading } from "./Loading"; export function Finish({ busy }) { return busy ? <Loading /> : <button>Finish</button>; }',
      [flow]:
        'import { Loading } from "./Loading"; import { Finish } from "./Finish"; export function Flow({ done }) { return done ? <Finish /> : <Loading />; }',
      [PAGE]:
        'import { Flow } from "./Flow"; export function Page() { return <section><Flow /></section>; }',
      [ENTRY]:
        'import { createRoot } from "react-dom/client"; import { Page } from "./Page"; createRoot(document.body).render(<Page />);',
    };
    const makePath = (id: string, nested: boolean): PreviewRenderChainCandidate => {
      const chain = nested ? [TARGET, loading, finish, flow, PAGE] : [TARGET, loading, flow, PAGE];
      const labels = ['Sparkle', 'Loading', ...(nested ? ['Finish'] : []), 'Flow', 'Page'];
      return {
        id,
        entryPoint: {
          kind: 'create-root',
          sourcePath: ENTRY,
          occurrenceStart: 0,
          wrapperNames: [],
        },
        steps: chain.map((sourcePath, index) => ({
          sourcePath,
          label: labels[index] ?? '',
          certainty: 'confirmed',
          kind: 'component-render',
          wrapperNames: [],
          occurrenceStart:
            (sources[chain[index + 1] ?? ENTRY] ?? '').indexOf('<' + (labels[index] ?? '')) + 1,
        })),
      };
    };
    const plan = await createPlan(sources, [
      makePath('direct-loading', false),
      makePath('nested-loading', true),
    ]);
    const paths = plan.renderChain.paths;
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const renderPath of paths) {
      const complete = plan.pageCandidates.find(
        (candidate) =>
          candidate.complete &&
          candidate.root.sourcePath === PAGE &&
          candidate.renderPath?.id === renderPath.id,
      );
      expect(complete, renderPath.steps.map((step) => step.label).join(' > ')).toBeDefined();
      const ownerPaths = complete?.edges.map((edge) => edge.owner.sourcePath) ?? [];
      expect(ownerPaths.includes(finish)).toBe(
        renderPath.steps.some((step) => step.sourcePath === finish),
      );
    }
  });
});
