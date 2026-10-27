/** Bounded direct route discovery constants and parsed-module contracts. */
import ts from 'typescript';

export const MAXIMUM_DIRECT_ROUTE_CHOICES = 4_096;

export const REACT_ROUTER_PACKAGE_PATTERN = /^(?:@remix-run\/react|react-router(?:-dom)?)$/u;

export const ROUTER_DESCRIPTOR_EXPORTS = new Set([
  'createBrowserRouter',
  'createHashRouter',
  'createMemoryRouter',
  'useRoutes',
]);

/** One imported runtime binding, including namespace imports used by route configurations. */
export interface ImportedBinding {
  readonly exportName: string;
  readonly moduleSpecifier: string;
  readonly namespace: boolean;
}

/** Mutable facts for one parsed route owner or delegated router configuration module. */
export interface ParsedRouteModule {
  readonly imports: ReadonlyMap<string, ImportedBinding>;
  readonly initializers: ReadonlyMap<string, ts.Expression>;
  readonly routerDescriptorBindings: ReadonlySet<string>;
  readonly routerNamespaces: ReadonlySet<string>;
  readonly routerProviderBindings: ReadonlySet<string>;
  readonly sourceFile: ts.SourceFile;
}

/** Work item used by the bounded RouterProvider/import delegation queue. */
export interface RouteModuleWorkItem {
  /** Imported export that may itself be a route descriptor aggregate. */
  readonly descriptorExportName?: string;
  readonly sourcePath: string;
  readonly sourceText?: string;
}
