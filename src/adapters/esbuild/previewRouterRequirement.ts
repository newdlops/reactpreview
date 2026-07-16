/**
 * Selects whether an active React source file needs the preview's isolated MemoryRouter.
 * The selector parses imports only and never resolves or evaluates application routes. This keeps
 * automatic routing generic while avoiding a second outer router around files that own one.
 */
import ts from 'typescript';

/** Router APIs whose first render can safely use a plain location-only MemoryRouter context. */
const MEMORY_ROUTER_CONSUMERS = new Set([
  'Link',
  'NavLink',
  'Navigate',
  'Redirect',
  'Route',
  'Routes',
  'Switch',
  'useHref',
  'useHistory',
  'useInRouterContext',
  'useLocation',
  'useMatch',
  'useNavigate',
  'useNavigationType',
  'useOutlet',
  'useOutletContext',
  'useParams',
  'useResolvedPath',
  'useRouteMatch',
  'useRoutes',
  'useSearchParams',
]);

/** Router providers that would reject or conflict with an automatically nested router. */
const APPLICATION_ROUTER_PROVIDERS = new Set([
  'BrowserRouter',
  'HashRouter',
  'HistoryRouter',
  'MemoryRouter',
  'Router',
  'RouterProvider',
  'StaticRouter',
  'unstable_HistoryRouter',
]);

/** Public graph signal collected independently for every target-reachable source module. */
export interface PreviewRouterRequirement {
  /** Whether the module imports and uses an API that reads React Router context. */
  readonly consumesRouter: boolean;
  /** Whether the module imports or accesses an API that creates a complete router boundary. */
  readonly ownsRouter: boolean;
}

/** Import inventory needed to make one conservative provider decision. */
interface RouterImportInventory {
  /** Imported runtime APIs that consume an existing router context. */
  readonly consumers: ReadonlySet<string>;
  /** Local names bound to a complete react-router-dom module namespace. */
  readonly namespaces: ReadonlySet<string>;
  /** Whether the active module imports an application-owned router provider. */
  readonly ownsRouter: boolean;
}

/**
 * Reports whether the current file directly consumes React Router without importing a provider.
 * Named imports are classified by their original export name, so aliases remain reliable. A
 * namespace import is enabled only when an actual property access selects a known consumer.
 *
 * @param documentPath Active source path used to choose TSX-aware parser behavior.
 * @param sourceText Current editor snapshot inspected without module resolution.
 * @returns `true` only when a plain MemoryRouter is useful and cannot obviously be nested.
 */
export function requiresPreviewRouter(documentPath: string, sourceText: string): boolean {
  const requirement = collectPreviewRouterRequirement(documentPath, sourceText);
  return requirement.consumesRouter && !requirement.ownsRouter;
}

/**
 * Collects router consumer and provider evidence from one reached module without resolving routes.
 * The compiler aggregates this result across esbuild's actual module graph, including dynamically
 * imported chunks, so a consumer hidden in a child component is not missed merely because the
 * active editor file contains no direct React Router import.
 *
 * @param documentPath Reached source path used to select TSX-aware parser behavior.
 * @param sourceText Source snapshot or filesystem content already loaded for bundling.
 * @returns Independent context-consumer and provider-ownership evidence.
 */
export function collectPreviewRouterRequirement(
  documentPath: string,
  sourceText: string,
): PreviewRouterRequirement {
  const sourceFile = ts.createSourceFile(
    documentPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(documentPath),
  );
  const inventory = collectRouterImports(sourceFile);
  const namespaceUsage = collectNamespaceUsage(sourceFile, inventory.namespaces);
  return {
    consumesRouter: inventory.consumers.size > 0 || namespaceUsage.consumesRouter,
    ownsRouter: inventory.ownsRouter || namespaceUsage.ownsRouter,
  };
}

/** Collects non-erased imports from the browser-facing React Router package. */
function collectRouterImports(sourceFile: ts.SourceFile): RouterImportInventory {
  const consumers = new Set<string>();
  const namespaces = new Set<string>();
  let ownsRouter = false;

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react-router-dom'
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
      continue;
    }
    const bindings = clause.namedBindings;
    if (bindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) {
        continue;
      }
      const importedName = (element.propertyName ?? element.name).text;
      if (APPLICATION_ROUTER_PROVIDERS.has(importedName)) {
        ownsRouter = true;
      }
      if (MEMORY_ROUTER_CONSUMERS.has(importedName)) {
        consumers.add(importedName);
      }
    }
  }
  return { consumers, namespaces, ownsRouter };
}

/** Finds known consumer or provider accesses made through a module namespace binding. */
function collectNamespaceUsage(
  sourceFile: ts.SourceFile,
  namespaceBindings: ReadonlySet<string>,
): PreviewRouterRequirement {
  const usage = { consumesRouter: false, ownsRouter: false };

  /** Visits property accesses without interpreting calls, JSX, or application route values. */
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaceBindings.has(node.expression.text)
    ) {
      if (APPLICATION_ROUTER_PROVIDERS.has(node.name.text)) {
        usage.ownsRouter = true;
      }
      if (MEMORY_ROUTER_CONSUMERS.has(node.name.text)) {
        usage.consumesRouter = true;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return usage;
}

/** Chooses a parser grammar from the source suffix without consulting project configuration. */
function readScriptKind(documentPath: string): ts.ScriptKind {
  const normalizedPath = documentPath.toLowerCase();
  if (normalizedPath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (
    normalizedPath.endsWith('.ts') ||
    normalizedPath.endsWith('.mts') ||
    normalizedPath.endsWith('.cts')
  ) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JSX;
}
