/** Emits selected-branch React Router runtimes without importing an application route registry. */
import type { PreviewInspectorRouteExecutionRecipe } from './previewInspectorPageExecutionTypes';
import { createPreviewInspectorRouteHref } from './previewInspectorRouteHref';
import { createPreviewInspectorV6RoutePattern } from './previewInspectorRoutePattern';
import { relativizePreviewInspectorRoutePattern } from './previewInspectorRoutePatternMatch';

/** Marks the one intentional exception used to activate a statically proven route error slot. */
export const PREVIEW_INSPECTOR_ROUTE_ERROR_PROBE_SYMBOL_KEY =
  'newdlops.react-file-preview.route-error-probe';

export interface CreatePreviewInspectorRouteExecutionRuntimeSourceOptions {
  readonly recipe: PreviewInspectorRouteExecutionRecipe;
  readonly renderedPage: string;
  readonly routeSurfaceLocals: readonly string[];
}

interface PreviewInspectorRouteExecutionRuntimeSource {
  readonly declarations?: readonly string[];
  readonly imports: readonly string[];
  readonly routeElement: string;
}

/**
 * Uses only MemoryRouter plus the mounted surfaces already admitted into the execution plan.
 * The generated route tree never invokes authored loaders or actions. A statically proven
 * errorElement target receives one isolated data-router error branch instead of an app registry.
 */
export function createPreviewInspectorRouteExecutionRuntimeSource(
  options: CreatePreviewInspectorRouteExecutionRuntimeSourceOptions,
): PreviewInspectorRouteExecutionRuntimeSource | undefined {
  if (options.recipe.rootOwnsRouter) return undefined;
  if (options.recipe.targetRole === 'error-element') {
    return options.recipe.kind === 'react-router-v6'
      ? createV6ErrorElementRuntime(options)
      : undefined;
  }
  if (options.recipe.kind === 'react-router-v6') return createV6Runtime(options);
  if (options.recipe.kind === 'react-router-v5') return createV5Runtime(options);
  return undefined;
}

/** Mounts the selected target as a real data-router errorElement without authored loaders. */
function createV6ErrorElementRuntime(
  options: CreatePreviewInspectorRouteExecutionRuntimeSourceOptions,
): PreviewInspectorRouteExecutionRuntimeSource {
  const routeHref = createPreviewInspectorRouteHref(
    options.recipe.pathname,
    options.recipe.searchParams,
  );
  return Object.freeze({
    declarations: Object.freeze([
      "const PreviewInspectorRouteError = new Error('React Preview route error probe');",
      `Object.defineProperty(PreviewInspectorRouteError, Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_ROUTE_ERROR_PROBE_SYMBOL_KEY)}), { value: true });`,
      'function PreviewInspectorRouteErrorTrigger() { throw PreviewInspectorRouteError; }',
      `const PreviewInspectorRouteErrorRouter = createMemoryRouter([{ path: '*', element: React.createElement(PreviewInspectorRouteErrorTrigger), errorElement: ${options.renderedPage} }], { initialEntries: [${JSON.stringify(routeHref)}] });`,
    ]),
    imports: Object.freeze([
      `import { createMemoryRouter, RouterProvider } from '${options.recipe.routerModuleSpecifier ?? 'react-router-dom'}';`,
    ]),
    routeElement:
      'React.createElement(RouterProvider, { router: PreviewInspectorRouteErrorRouter })',
  });
}

/** Emits a nested v6 Route tree so authored Outlet layouts receive their selected child. */
function createV6Runtime(options: CreatePreviewInspectorRouteExecutionRuntimeSourceOptions): {
  readonly imports: readonly string[];
  readonly routeElement: string;
} {
  const { recipe } = options;
  const routePattern = createPreviewInspectorV6RoutePattern(recipe.pattern);
  const routeHref = createPreviewInspectorRouteHref(recipe.pathname, recipe.searchParams);
  const nested =
    options.routeSurfaceLocals.length === 0
      ? `React.createElement(Route, { path: ${JSON.stringify(
          createPreviewInspectorV6RoutePattern(recipe.mounts[0]?.contextPattern ?? recipe.pattern),
        )}, element: ${options.renderedPage} })`
      : options.routeSurfaceLocals
          .slice()
          .reverse()
          .reduce((child, local, reverseIndex) => {
            const mountIndex = options.routeSurfaceLocals.length - reverseIndex - 1;
            const mount = recipe.mounts[mountIndex];
            const contextPattern = mount?.contextPattern;
            const previousBasePath = recipe.mounts[mountIndex - 1]?.basePath;
            const nestedContextPattern =
              mountIndex > 0 && contextPattern !== undefined && previousBasePath !== undefined
                ? (relativizePreviewInspectorRoutePattern(previousBasePath, contextPattern) ??
                  contextPattern)
                : contextPattern;
            const mountedPattern =
              nestedContextPattern === undefined
                ? reverseIndex === options.routeSurfaceLocals.length - 1
                  ? routePattern
                  : ''
                : createPreviewInspectorV6RoutePattern(nestedContextPattern);
            const route = `React.createElement(Route, { path: ${JSON.stringify(mountedPattern)}, element: React.createElement(${local}, null) }`;
            // A proven factory owner renders its own relative route slots. Adding an outer index
            // child makes React Router discard that owner after an authored Navigate reaches one
            // of its sibling routes, removing persistent layout, menus, and overlay coordinators.
            return mount?.contextOrigin === 'virtual-page-owner'
              ? `${route})`
              : `${route}, ${child})`;
          }, `React.createElement(Route, { index: true, element: ${options.renderedPage} })`);
  return Object.freeze({
    imports: Object.freeze([
      `import { MemoryRouter, Route, Routes } from '${options.recipe.routerModuleSpecifier ?? 'react-router-dom'}';`,
    ]),
    routeElement: `React.createElement(MemoryRouter, { initialEntries: [${JSON.stringify(routeHref)}] }, React.createElement(Routes, null, ${nested}))`,
  });
}

/** Emits the selected v5 Route only, preserving route props without loading a Switch registry. */
function createV5Runtime(options: CreatePreviewInspectorRouteExecutionRuntimeSourceOptions): {
  readonly imports: readonly string[];
  readonly routeElement: string;
} {
  const pattern = options.recipe.pattern;
  const routeHref = createPreviewInspectorRouteHref(
    options.recipe.pathname,
    options.recipe.searchParams,
  );
  // React Router v5 route-owner components contain their own nested Switch/Route registry instead
  // of consuming a v6 Outlet. Mount the outermost compiler-proven owner and let that authored
  // registry expand the selected pathname. Rendering the terminal leaf here discards application
  // chrome such as HospitalRun, Appointments, and EditAppointment.
  const routeOwnerLocal = options.routeSurfaceLocals[0];
  const selectedBranch =
    routeOwnerLocal === undefined
      ? `() => ${options.renderedPage}`
      : `(routeProps) => React.createElement(${routeOwnerLocal}, routeProps)`;
  return Object.freeze({
    imports: Object.freeze([
      `import { MemoryRouter, Route } from '${options.recipe.routerModuleSpecifier ?? 'react-router-dom'}';`,
    ]),
    routeElement: `React.createElement(MemoryRouter, { initialEntries: [${JSON.stringify(routeHref)}] }, React.createElement(Route, { path: ${JSON.stringify(pattern)}, render: ${selectedBranch} }))`,
  });
}
