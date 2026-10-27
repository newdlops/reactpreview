/**
 * Registers declared response shapes of REST calls made through imported HTTP client instances,
 * generic project helpers (`fetchJson<Settings>('/api/settings')`), and SWR hooks
 * (`useSWR<User>('/api/me', fetcher)`).
 *
 * Calls such as `apiClient.get<Summary>('/summary')` on an instance created in another module are
 * not rewritten, because replacing them would bypass the instance's base URL and interceptors;
 * the Page Inspector answers them at the XMLHttpRequest boundary, where no type evidence exists.
 * This transform keeps the call and instead queues `[method, path pattern, shape]` at module end.
 * The data runtime matches a request without its own shape against the queue by method and path
 * suffix, so the declared body type (lists, numbers, closed literal unions) replaces endpoint-name
 * guesses. A path segment built from an expression becomes a `*` wildcard.
 */
import ts from 'typescript';
import type { PreviewTypeOracleView } from '../typeOracle/previewTypeOracle';
import {
  createPreviewRuntimeCallOccurrenceCounter,
  readPreviewRuntimeHookCallOccurrence,
} from './previewRuntimeHookTypedFallback';
import { readPreviewTypeNodeOccurrence } from './previewTypedResponseShape';

/** `Symbol.for` key of the queue of `[method, pattern, shape]` entries shared with the runtime. */
export const PREVIEW_TYPED_REST_ENDPOINTS_KEY = 'newdlops.react-file-preview.typed-rest-endpoints';

const HTTP_METHODS = new Map([
  ['delete', 'DELETE'],
  ['get', 'GET'],
  ['patch', 'PATCH'],
  ['post', 'POST'],
  ['put', 'PUT'],
]);
const MAX_ENDPOINTS_PER_MODULE = 64;
const MAX_ORACLE_QUERIES_PER_MODULE = 128;
const MAX_SHAPE_SOURCE_LENGTH = 64 * 1024;
// Probe from the argument's opening parenthesis instead of rescanning generic type spans.
// The AST below owns callee/type-argument validation, including comments and parenthesized types.
const REQUEST_CALL_PATTERN = /\.(?:delete|get|patch|post|put)\s*[<(]|\(\s*['"`](?:\/|https?:\/\/)/u;
/** Helper names that read as requests when the response type is inferred, not written. */
const REQUEST_HELPER_NAME_PATTERN = /fetch|request|load|get|api|http|json|query/iu;
const SWR_MODULES = new Set(['swr', 'swr/immutable']);

/**
 * Creates the module-end registration for every typed request call with a static path.
 *
 * @param oracle Build-scoped declared-type oracle, absent outside Page Inspector builds.
 * @param sourcePath Absolute module path.
 * @param sourceText Transform input, matched against the analysis program by call text.
 * @returns At most one guarded statement; empty when no call qualified.
 */
export function createPreviewTypedRestEndpointRegistrations(
  oracle: PreviewTypeOracleView | undefined,
  sourcePath: string,
  sourceText: string,
): readonly string[] {
  if (oracle === undefined || !REQUEST_CALL_PATTERN.test(sourceText)) return [];
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/u.test(sourcePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const entries: string[] = [];
  const swrNames = collectSwrHookNames(sourceFile);
  const readOccurrence = createPreviewRuntimeCallOccurrenceCounter();
  let queries = 0;
  const register = (method: string, pattern: string, shape: unknown, helper: boolean): void => {
    // A helper must return a payload; `router.push('/settings')` resolves to a boolean.
    if (helper && !isPayloadShape(shape)) return;
    const shapeSource = shape === undefined ? undefined : JSON.stringify(shape);
    if (shapeSource !== undefined && shapeSource.length <= MAX_SHAPE_SOURCE_LENGTH) {
      entries.push(
        `registry.push([${JSON.stringify(method)}, ${JSON.stringify(pattern)}, ${shapeSource}]);`,
      );
    }
  };
  const visit = (node: ts.Node): void => {
    if (entries.length >= MAX_ENDPOINTS_PER_MODULE || queries >= MAX_ORACLE_QUERIES_PER_MODULE)
      return;
    if (ts.isCallExpression(node)) {
      const pattern = readEndpointPattern(node.arguments[0]);
      // Identical call text has the same first path argument; unrelated calls cannot affect ordinals.
      const occurrence =
        pattern === undefined ? undefined : readOccurrence(node.getText(sourceFile));
      const calleeName = readCalleeName(node.expression);
      const clientMethod = ts.isPropertyAccessExpression(node.expression)
        ? HTTP_METHODS.get(node.expression.name.text)
        : undefined;
      if (pattern !== undefined && clientMethod !== undefined) {
        queries += 1;
        register(clientMethod, pattern, readCallShape(node, occurrence), false);
      } else if (pattern !== undefined && calleeName !== undefined && swrNames.has(calleeName)) {
        const typeArgument = node.typeArguments?.[0];
        if (typeArgument !== undefined) {
          queries += 1;
          register(
            'GET',
            pattern,
            oracle.readTypedResponseShape({
              occurrence: readPreviewTypeNodeOccurrence(sourceFile, typeArgument),
              sourcePath,
              typeText: typeArgument.getText(sourceFile),
            }),
            true,
          );
        }
      } else if (
        pattern !== undefined &&
        calleeName !== undefined &&
        calleeName !== 'fetch' &&
        (node.typeArguments !== undefined || REQUEST_HELPER_NAME_PATTERN.test(calleeName))
      ) {
        queries += 1;
        register(
          readHelperMethod(node, calleeName),
          pattern,
          readCallShape(node, occurrence),
          true,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  const readCallShape = (node: ts.CallExpression, occurrence: number | undefined): unknown =>
    oracle.readTypedCallResponseShape({
      callText: node.getText(sourceFile),
      occurrence: occurrence ?? readPreviewRuntimeHookCallOccurrence(sourceFile, node),
      sourcePath,
    });
  visit(sourceFile);
  if (entries.length === 0) return [];
  const key = JSON.stringify(PREVIEW_TYPED_REST_ENDPOINTS_KEY);
  return [
    `try { const registry = globalThis[Symbol.for(${key})] || (globalThis[Symbol.for(${key})] = []); ${entries.join(' ')} } catch {}`,
  ];
}

/** Local names of SWR's hooks imported by this module. */
function collectSwrHookNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !SWR_MODULES.has(statement.moduleSpecifier.text)
    )
      continue;
    const clause = statement.importClause;
    if (clause?.name !== undefined) names.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (imported === 'default' || imported.startsWith('useSWR')) names.add(element.name.text);
      }
    }
  }
  return names;
}

/** Returns the called function's name: `fetchJson` or the member of `api.fetchJson`. */
function readCalleeName(callee: ts.Expression): string | undefined {
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
}

/** Reads a static `method` option, else a verb prefix of the helper name, else GET. */
function readHelperMethod(node: ts.CallExpression, calleeName: string): string {
  for (const argument of node.arguments.slice(1)) {
    if (!ts.isObjectLiteralExpression(argument)) continue;
    for (const property of argument.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'method' &&
        ts.isStringLiteralLike(property.initializer)
      ) {
        const method = HTTP_METHODS.get(property.initializer.text.toLowerCase());
        if (method !== undefined) return method;
      }
    }
  }
  const verb = /^(delete|patch|post|put)/iu.exec(calleeName)?.[1]?.toLowerCase();
  return (verb === undefined ? undefined : HTTP_METHODS.get(verb)) ?? 'GET';
}

/** Accepts object and array payload shapes only. */
function isPayloadShape(shape: unknown): boolean {
  const kind = (shape as { readonly kind?: unknown } | undefined)?.kind;
  return kind === 'object' || kind === 'array';
}

/**
 * Reads a static request path, turning template expressions into `*` wildcards. Query strings,
 * fragments, and origins are dropped; a pattern needs at least one literal path segment.
 */
function readEndpointPattern(argument: ts.Expression | undefined): string | undefined {
  if (argument === undefined) return undefined;
  let text: string;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    text = argument.text;
  } else if (ts.isTemplateExpression(argument)) {
    text = argument.head.text;
    for (const span of argument.templateSpans) text += `*${span.literal.text}`;
  } else {
    return undefined;
  }
  // Only path-like text is an endpoint; `params.get('page')` or `map.get('key')` is not.
  if (!/^(?:\/|https?:\/\/|\*\/)/u.test(text)) return undefined;
  const withoutQuery = text.split(/[?#]/u)[0] ?? '';
  const pathOnly = withoutQuery.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/iu, '');
  const pattern = `/${pathOnly.replace(/^\/+/u, '')}`.replace(/\/{2,}/gu, '/');
  return /[A-Za-z0-9_-]/u.test(pattern.replace(/\*/gu, '')) ? pattern : undefined;
}
