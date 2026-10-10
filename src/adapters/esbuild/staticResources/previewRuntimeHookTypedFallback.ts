/**
 * Connects the declared-type oracle to runtime hook instrumentation.
 *
 * The instrumentation stays syntax-first: these helpers only attach an optional typed value to a
 * hook site's metadata. A site with syntax evidence keeps its evidence (compared literals, guard
 * paths) and gains type-correct leaves; a site without syntax evidence becomes "typed-only", which
 * the runtime uses solely when the hook throws. Payloads are bounded so declared types cannot
 * inflate every instrumented module.
 */
import ts from 'typescript';
import type { PreviewTypedCallValue, PreviewTypeOracleView } from '../typeOracle/previewTypeOracle';
import { prunePreviewTypedValue } from '../typeOracle/previewTypeValueSynthesizer';

/** Resolves the declared result type of one hook call in the module being transformed. */
export type PreviewRuntimeHookTypedCallResolver = (
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  requiredPaths: readonly string[],
) => PreviewTypedCallValue | undefined;

/** Metadata fields carried to `resolveRuntimeHook`; all are optional and JSON-safe. */
export interface PreviewRuntimeHookTypedMetadata {
  /** Allowed literal values per descriptor path (`a.b[].c`). */
  readonly typedLiterals?: Readonly<Record<string, readonly (boolean | number | string)[]>>;
  /** Marks a site instrumented only because its declared type is known. */
  readonly typedOnly?: true;
  /** Declared-type value descriptor (see previewTypeValueSynthesizer). */
  readonly typedValue?: unknown;
}

/**
 * Fallback for a hook with no local syntax evidence. `preserveNullish` keeps authored nullish
 * results, and the runtime returns every successful value unchanged for typed-only sites, so the
 * declared-type value substitutes only when the hook throws (for example a missing Provider).
 */
export const PREVIEW_RUNTIME_HOOK_TYPED_ONLY_FALLBACK = Object.freeze({
  evidence: 'declared TypeScript result type',
  expression: 'undefined',
  label: 'declared-type value',
  preserveNullish: true,
  requiredPaths: Object.freeze([] as string[]),
});

/** Keeps one site's typed payload small relative to ordinary hook metadata. */
const MAX_TYPED_METADATA_JSON_LENGTH = 16 * 1024;

/**
 * Serializes a typed value into bounded hook metadata. An oversized value, such as a GraphQL
 * result wrapped in Apollo's `QueryResult`, is pruned to the authored usage paths before the
 * size bound is applied, so the leaves the code reads keep their declared literals.
 *
 * @param typed Oracle result for the hook call, if any.
 * @param typedOnly Whether the site has no syntax-derived fallback of its own.
 * @param requiredPaths Authored usage paths used to prune an oversized value.
 * @returns Metadata fields, or an empty object when absent or still over the size bound.
 */
export function createPreviewRuntimeHookTypedMetadata(
  typed: PreviewTypedCallValue | undefined,
  typedOnly: boolean,
  requiredPaths: readonly string[] = [],
): PreviewRuntimeHookTypedMetadata {
  if (typed === undefined) return {};
  const full = createMetadata(typed.value, typed.literals, typedOnly);
  if (JSON.stringify(full).length <= MAX_TYPED_METADATA_JSON_LENGTH) return full;
  const demanded = requiredPaths.map(normalizeDemandPath).filter((path) => path.length > 0);
  if (demanded.length === 0) return {};
  const literals = Object.fromEntries(
    Object.entries(typed.literals).filter(([path]) =>
      demanded.some((prefix) => isPathWithin(normalizeDemandPath(path), prefix)),
    ),
  );
  const pruned = createMetadata(
    prunePreviewTypedValue(typed.value, requiredPaths),
    literals,
    typedOnly,
  );
  return JSON.stringify(pruned).length <= MAX_TYPED_METADATA_JSON_LENGTH ? pruned : {};
}

/** Assembles the metadata fields, omitting an empty literal table. */
function createMetadata(
  value: unknown,
  literals: Readonly<Record<string, readonly (boolean | number | string)[]>>,
  typedOnly: boolean,
): PreviewRuntimeHookTypedMetadata {
  return {
    ...(Object.keys(literals).length === 0 ? {} : { typedLiterals: literals }),
    ...(typedOnly ? { typedOnly: true as const } : {}),
    typedValue: value,
  };
}

/**
 * Normalizes `rows[].id`, `rows.[].id`, `rows[0].id`, and `rows.id?` to one dotted form, so the
 * synthesizer's literal paths and the analyzers' usage paths can be compared by prefix.
 */
function normalizeDemandPath(path: string): string {
  return path
    .replace(/\(\)$/u, '')
    .replace(/\.?\[\d*\]/gu, '')
    .replace(/\?/gu, '');
}

/** Reports whether `path` equals `prefix` or lies below it. */
function isPathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`);
}

/**
 * Adapts a build's oracle view to the instrumentation's call-node callback.
 *
 * @param oracle Build-scoped oracle, absent when type analysis is disabled for the build.
 * @param sourcePath Absolute module path being transformed.
 * @returns Resolver, or `undefined` so the instrumentation stays purely syntax-based.
 */
export function createPreviewRuntimeHookTypedCallResolver(
  oracle: PreviewTypeOracleView | undefined,
  sourcePath: string,
): PreviewRuntimeHookTypedCallResolver | undefined {
  if (oracle === undefined) return undefined;
  return (call, sourceFile, requiredPaths) =>
    oracle.readTypedCallValue({
      callText: call.getText(sourceFile),
      occurrence: readPreviewRuntimeHookCallOccurrence(sourceFile, call),
      requiredPaths,
      sourcePath,
    });
}

/**
 * Counts earlier call expressions with identical text, in the same pre-order the oracle uses.
 *
 * @param sourceFile Parse of the transform input.
 * @param call Call expression inside that parse.
 * @returns Zero-based occurrence index used to find the same call in the analysis program.
 */
export function readPreviewRuntimeHookCallOccurrence(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): number {
  const callText = call.getText(sourceFile);
  let occurrence = 0;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node === call) {
      found = true;
      return;
    }
    if (ts.isCallExpression(node) && node.getText(sourceFile) === callText) occurrence += 1;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return occurrence;
}
