/** Verifies that an App previewed by itself keeps its own Routes in charge of the selected path. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PreviewInspectorPageCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorTypes';
import type {
  PreviewInspectorMountSurface,
  PreviewInspectorRouteExecutionRecipe,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';
import { createRouteRecipe } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageRouteRecipe';
import { createPreviewInspectorRouteExecutionRuntimeSource } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteExecutionRuntimeSource';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

/** One authentic module-export surface. */
function surface(sourcePath: string, exportName: string, id: string): PreviewInspectorMountSurface {
  return {
    bypassedWrapperNames: [],
    exportName,
    id,
    omittedTopLevelEffectCount: 0,
    sourcePath,
    strategy: 'authentic-module-export',
    watchSourcePaths: [sourcePath],
  };
}

/** A route choice declared in App.tsx, selected while App or one of its pages is the target. */
async function createAppCandidate(
  target: { readonly exportName: string; readonly sourcePath: string } | undefined,
): Promise<{ readonly appPath: string; readonly candidate: PreviewInspectorPageCandidate }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'react-preview-content-routes-'));
  temporaryRoots.push(root);
  const appPath = path.join(root, 'App.tsx');
  await writeFile(
    appPath,
    [
      "import { Navigate, Route, Routes } from 'react-router-dom';",
      'export default function App() {',
      '  return <Routes><Route path="/reset-password" element={<p />} />',
      '    <Route path="*" element={<Navigate to="/dashboard" replace />} /></Routes>;',
      '}',
    ].join('\n'),
    'utf8',
  );
  const candidate = {
    root: { exportName: 'default', sourcePath: appPath },
    rootOwnsRouter: false,
    routeLocation: {
      componentName: 'ResetPasswordPage',
      dependencyPaths: [],
      evidenceKind: 'route-jsx',
      pathname: '/reset-password',
      pattern: '/reset-password',
      sourcePath: appPath,
    },
    target: target ?? { exportName: 'default', sourcePath: appPath },
  } as unknown as PreviewInspectorPageCandidate;
  return { appPath, candidate };
}

/** Emits the generated v6 route tree around a placeholder page expression. */
function routeElement(
  recipe: PreviewInspectorRouteExecutionRecipe | undefined,
): string | undefined {
  if (recipe === undefined) throw new Error('Expected a selected-route recipe.');
  return createPreviewInspectorRouteExecutionRuntimeSource({
    recipe,
    renderedPage: 'Page',
    routeSurfaceLocals: [],
  })?.routeElement;
}

describe('content-root route ownership', () => {
  /** A signed-in App redirects `/reset-password` to `/dashboard`; the App must stay mounted. */
  it('mounts an App that declares the selected route at a splat path', async () => {
    const { appPath, candidate } = await createAppCandidate(undefined);
    const app = surface(appPath, 'default', 'target:app');

    const recipe = createRouteRecipe(candidate, [], app, app);

    expect(recipe?.contentRootOwnsRoutes).toBe(true);
    expect(recipe?.pattern).toBe('/reset-password');
    const element = routeElement(recipe);
    expect(element).toContain('initialEntries: ["/reset-password"]');
    expect(element).toContain('React.createElement(Route, { path: "/*", element: Page })');
  });

  /** A route declared elsewhere keeps the exact selected path around the rendered page. */
  it('keeps the exact selected path when the content root does not declare the route', async () => {
    const { appPath, candidate } = await createAppCandidate(undefined);
    const pagePath = path.join(path.dirname(appPath), 'ResetPasswordPage.tsx');
    await writeFile(pagePath, 'export function ResetPasswordPage() { return <p />; }', 'utf8');
    const page = surface(pagePath, 'ResetPasswordPage', 'page:reset');
    const leaf = {
      ...candidate,
      target: { exportName: 'ResetPasswordPage', sourcePath: pagePath },
    } as PreviewInspectorPageCandidate;

    const recipe = createRouteRecipe(leaf, [], page, page);

    expect(recipe?.contentRootOwnsRoutes).toBeUndefined();
    expect(routeElement(recipe)).toContain(
      'React.createElement(Route, { path: "/reset-password", element: Page })',
    );
  });
});
