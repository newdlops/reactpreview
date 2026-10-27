/** Reproduces a shared modal whose ranked page and catalog insertion order disagree. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';
import {
  createFactoryProviderRouteOptions,
  FACTORY_ROUTE_SOURCE_ROOT as ROOT,
} from './previewInspectorRouteBranchFactoryOwnerFixtures';

const TARGET = `${ROOT}/shared-modal.tsx`;
const BODY = `${ROOT}/preview-body.tsx`;
const ENTRY = `${ROOT}/entry.tsx`;
const PREVIEW_IMPL = `${ROOT}/preview-page-impl.tsx`;
const EDIT_PATTERN = '/root/:areaId(\\d+)/detail/:kind/:detailId(\\d+)/edit';

/** Reuses the real static factory contract while keeping every fixture module inert. */
async function createFixture(
  style: 'direct' | 'lazy' | 'reexport' = 'direct',
): Promise<Parameters<typeof createPreviewInspectorAncestorPlan>[0]> {
  const base = createFactoryProviderRouteOptions();
  const originalDetailApp = await base.readSource(`${ROOT}/detail-app.tsx`);
  const replacements: Readonly<Record<string, string>> = {
    [TARGET]: 'export function SharedModal() { return <dialog />; }',
    [BODY]: [
      'import { SharedModal } from "./shared-modal";',
      'export function PreviewBody() { return <SharedModal />; }',
    ].join('\n'),
    [PREVIEW_IMPL]: [
      'import { PreviewBody } from "./preview-body";',
      'export default function PreviewPage() { return <PreviewBody />; }',
    ].join('\n'),
    [`${ROOT}/preview-page.tsx`]:
      style === 'lazy'
        ? 'import { lazy } from "react"; export const PreviewPage = lazy(() => import("./preview-page-impl"));'
        : style === 'reexport'
          ? 'export { default as PreviewPage } from "./preview-page-impl";'
          : 'import { PreviewBody } from "./preview-body"; export function PreviewPage() { return <PreviewBody />; }',
    [`${ROOT}/edit-page.tsx`]: [
      'import { SharedModal } from "./shared-modal";',
      'export function EditPage() { return <SharedModal />; }',
    ].join('\n'),
    [`${ROOT}/detail-app.tsx`]: (originalDetailApp ?? '').replace(
      '{ PreviewPage, EditPage }',
      '{ EditPage, PreviewPage }',
    ),
    [ENTRY]: [
      'import { createRoot } from "react-dom/client";',
      'import { RootApp } from "./root-app";',
      'createRoot(document.body).render(<RootApp />);',
    ].join('\n'),
  };
  const sourcePaths = [...new Set([...base.sourcePaths, ...Object.keys(replacements)])];
  const makePath = (
    id: string,
    middle: readonly (readonly [string, string])[],
  ): PreviewRenderChainCandidate => ({
    id,
    entryPoint: { kind: 'create-root', sourcePath: ENTRY, occurrenceStart: 0, wrapperNames: [] },
    steps: [
      ['SharedModal', TARGET],
      ...middle,
      ['DetailApp', `${ROOT}/detail-app.tsx`],
      ['AreaApp', `${ROOT}/area-app.tsx`],
      ['RootApp', `${ROOT}/root-app.tsx`],
    ].map(([label = '', sourcePath = '']) => ({
      label,
      sourcePath,
      certainty: 'confirmed',
      kind: 'component-render',
      occurrenceStart: 0,
      wrapperNames: [],
    })),
  });
  const previewMiddle: readonly (readonly [string, string])[] = [
    ['PreviewBody', BODY],
    ...(style === 'direct' ? [] : [['PreviewPage', PREVIEW_IMPL] as const]),
    ['PreviewPage', `${ROOT}/preview-page.tsx`],
  ];
  const previewPath = makePath('preview-caller', previewMiddle);
  const renderChain = {
    dependencyPaths: sourcePaths,
    paths: [
      makePath('edit-caller', [['EditPage', `${ROOT}/edit-page.tsx`]]),
      {
        ...previewPath,
        steps: previewPath.steps.map((step) =>
          step.sourcePath === PREVIEW_IMPL
            ? { ...step, kind: style === 'lazy' ? ('react-lazy' as const) : ('re-export' as const) }
            : step,
        ),
      },
    ],
    reachability: 'entry-connected' as const,
    target: { sourcePath: TARGET, exportName: 'SharedModal' },
    truncated: false,
  };
  return {
    documentPath: TARGET,
    exportName: 'SharedModal',
    readSource: (sourcePath: string) =>
      replacements[sourcePath] === undefined
        ? base.readSource(sourcePath)
        : Promise.resolve(replacements[sourcePath]),
    resolveModule: (specifier: string, importer: string) => {
      const stem = path.resolve(path.dirname(importer), specifier);
      return (
        ['', '.ts', '.tsx']
          .map((suffix) => stem + suffix)
          .find((candidate) => sourcePaths.includes(candidate)) ??
        base.resolveModule?.(specifier, importer)
      );
    },
    renderChainsByExport: { SharedModal: renderChain },
    sourcePaths,
  };
}

describe('automatic route and consuming page alignment', () => {
  it.each(['direct', 'lazy', 'reexport'] as const)(
    'keeps the %s page on its own catalog route and retains other caller paths',
    async (style) => {
      const plan = await createPreviewInspectorAncestorPlan(await createFixture(style));

      expect(plan.pageCandidates[0]?.renderPath?.id).toBe('preview-caller');
      expect(plan.pageCandidates[0]?.routeLocation?.componentName).toBe('PreviewPage');
      expect(new Set(plan.pageCandidates.map((candidate) => candidate.renderPath?.id))).toEqual(
        new Set(['edit-caller', 'preview-caller']),
      );
      expect(plan.routeBranches?.some((branch) => branch.componentName === 'EditPage')).toBe(true);
      expect(plan.routeSelectionResolution).toBe('automatic');
    },
  );

  it('preserves an explicit catalog choice instead of replacing it with the ranked default', async () => {
    const plan = await createPreviewInspectorAncestorPlan({
      ...(await createFixture()),
      routeSelection: [{ componentName: 'EditPage', pattern: EDIT_PATTERN }],
    });

    expect(plan.pageCandidates[0]?.routeLocation?.componentName).toBe('EditPage');
    expect(plan.routeSelectionResolution).toBe('exact');
  });
});
