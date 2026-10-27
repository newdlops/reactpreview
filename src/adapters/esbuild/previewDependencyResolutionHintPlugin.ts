/** Applies compiler-validated neural dependency hints without weakening ordinary module resolution. */
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import type { PreviewLearnedServerContractExample } from './previewAdjacentTestContractEvidence';
import type { PreviewDependencyResolutionNeuralScore } from './previewDependencyResolutionNeuralModel';
import {
  PREVIEW_LIFECYCLE_END_TIMESTAMP_PATTERN,
  PREVIEW_TIMESTAMP_NAME_PATTERN,
} from './previewLifecycleTimestamp';
import { PREVIEW_COMPILER_PRIVATE_NAMESPACES } from './previewOwnedNamespaceRegistry';
import { PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';
import { PREVIEW_PRISMA_QUERY_METHOD_PATTERN } from './previewPrismaQueryMethods';
import {
  createPreviewSampleDateRebaseExpression,
  PREVIEW_CANONICAL_SAMPLE_DATE_TIME,
} from './previewSampleDateRuntimeSource';
import { createPreviewSampleLabel } from './previewSampleLabel';
import { collectPreviewRenderModuleFacts } from './renderGraph/previewRenderModuleFacts';

const SOURCE_FILTER = /\.[cm]?[jt]sx?$/;
const STYLE_MODULE_PATTERN = /\.(?:css|less|sass|scss|styl)$/i;
/** Facade-scope expression of the neutral contract value, for slots without a known type. */
export const PREVIEW_SERVER_CONTRACT_NEUTRAL_VALUE_EXPRESSION = 'contract';
const SERVER_ONLY_IMPORT_PATTERN = /(?:^|\n)\s*import\s*["']server-only["']\s*;?/u;
const USE_SERVER_DIRECTIVE_PATTERN = /(?:^|\n)\s*["']use server["']\s*;?/u;

/** One server export's declared-type function and whether its result may be nullish. */
export interface PreviewTypedServerExport {
  /** Side-effect-free function expression; `contract` stands for slots of unresolved types. */
  readonly expression: string;
  /** A mock returning nothing is still a valid result of the declared type. */
  readonly nullableResult: boolean;
}

/** Exact, retry-scoped source and package identities selected by the dependency recovery advisor. */
export interface PreviewDependencyResolutionHintPluginOptions {
  readonly facadeHints?: readonly {
    readonly contractExamples?: readonly PreviewLearnedServerContractExample[];
    readonly evidenceSourcePaths?: readonly string[];
    readonly score: PreviewDependencyResolutionNeuralScore;
    readonly sourcePath: string;
  }[];
  readonly facadeSourcePaths: readonly string[];
  readonly onHintApplied?: (score: PreviewDependencyResolutionNeuralScore) => void;
  readonly packageContractHints?: readonly {
    readonly moduleSpecifier: string;
    readonly score?: PreviewDependencyResolutionNeuralScore;
    readonly sourcePath: string;
  }[];
  readonly readSource?: (sourcePath: string) => Promise<string | undefined> | string | undefined;
  /**
   * Returns a function built from one server-module export's declared callable type, or
   * `undefined` when no type is known. It replaces the neutral proxy, and replaces a bare mock
   * (`vi.fn()`, which returns nothing) only when the declared result cannot be nullish. Learned
   * example values always win.
   */
  readonly readTypedExportExpression?: (
    sourcePath: string,
    exportName: string,
  ) => PreviewTypedServerExport | undefined;
  readonly styleHints?: readonly {
    readonly moduleSpecifier: string;
    readonly score?: PreviewDependencyResolutionNeuralScore;
    readonly sourcePath: string;
  }[];
  readonly workspaceRoot: string;
}

/**
 * Applies only deterministically admitted contracts selected after a concrete missing-package
 * build failure. Normal resolution always runs first, and exact importer/specifier identities keep
 * unrelated missing imports on esbuild's ordinary failure path.
 */
export function createPreviewDependencyResolutionHintPlugin(
  options: PreviewDependencyResolutionHintPluginOptions,
): Plugin {
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const hintedPaths = new Set(
    options.facadeSourcePaths
      .map((sourcePath) => canonicalizeHintPath(sourcePath, workspaceRoot))
      .filter((sourcePath): sourcePath is string => sourcePath !== undefined),
  );
  const facadeHintByPath = new Map(
    (options.facadeHints ?? []).flatMap((hint) => {
      const sourcePath = canonicalizeHintPath(hint.sourcePath, workspaceRoot);
      return sourcePath === undefined ? [] : [[sourcePath, hint] as const];
    }),
  );
  const packageHintSpecifiers = new Set<string>();
  const packageContractHints = new Map(
    (options.packageContractHints ?? []).flatMap((hint) => {
      const sourcePath = canonicalizeHintPath(hint.sourcePath, workspaceRoot);
      if (sourcePath === undefined) return [];
      const moduleSpecifier = hint.moduleSpecifier;
      packageHintSpecifiers.add(moduleSpecifier);
      return [[createHintKey(sourcePath, moduleSpecifier), hint] as const];
    }),
  );
  const styleHintSpecifiers = new Set<string>();
  const styleHints = new Map(
    (options.styleHints ?? []).flatMap((hint) => {
      const sourcePath = canonicalizeHintPath(hint.sourcePath, workspaceRoot);
      if (sourcePath === undefined) return [];
      const moduleSpecifier = hint.moduleSpecifier;
      styleHintSpecifiers.add(moduleSpecifier);
      return [[createHintKey(sourcePath, moduleSpecifier), hint] as const];
    }),
  );
  const recordedOutcomes = new Set<string>();
  return {
    name: 'react-preview-neural-dependency-hints',
    setup(build): void {
      /** Lets the real package graph win, then supplies only an exact missing style edge. */
      async function resolveHintedStyleContract(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (
          arguments_.namespace !== 'file' ||
          (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
          (arguments_.kind !== 'import-rule' && !STYLE_MODULE_PATTERN.test(arguments_.path))
        ) {
          return undefined;
        }
        if (!styleHintSpecifiers.has(arguments_.path)) return undefined;
        const importerPath = canonicalizeHintPath(arguments_.importer, workspaceRoot);
        if (importerPath === undefined) return undefined;
        const hintKey = createHintKey(importerPath, arguments_.path);
        const hint = styleHints.get(hintKey);
        if (hint === undefined) return undefined;
        const resolution = await build.resolve(arguments_.path, {
          importer: arguments_.importer,
          kind: arguments_.kind,
          namespace: arguments_.namespace,
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: arguments_.resolveDir,
        });
        if (resolution.errors.length === 0 && resolution.path.length > 0 && !resolution.external) {
          return resolution;
        }
        recordAppliedHint(`style:${hintKey}`, hint.score);
        return {
          namespace: PREVIEW_COMPILER_PRIVATE_NAMESPACES.dependencyStyleHint,
          path: arguments_.path,
          sideEffects: true,
          warnings: [
            ...resolution.warnings,
            {
              text:
                `React Preview used a neural dependency hint to replace the unavailable style ` +
                `module "${arguments_.path}" with an empty render-only stylesheet contract.`,
            },
          ],
        };
      }

      /** Preserves an unmarked wrapper module while neutralizing only its missing server package. */
      async function resolveHintedPackageContract(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (
          arguments_.namespace !== 'file' ||
          arguments_.kind === 'import-rule' ||
          (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD
        ) {
          return undefined;
        }
        if (!packageHintSpecifiers.has(arguments_.path)) return undefined;
        const importerPath = canonicalizeHintPath(arguments_.importer, workspaceRoot);
        if (importerPath === undefined) return undefined;
        const hintKey = createHintKey(importerPath, arguments_.path);
        const hint = packageContractHints.get(hintKey);
        if (hint === undefined) return undefined;
        const resolution = await build.resolve(arguments_.path, {
          importer: arguments_.importer,
          kind: arguments_.kind,
          namespace: arguments_.namespace,
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: arguments_.resolveDir,
        });
        if (resolution.errors.length === 0 && resolution.path.length > 0 && !resolution.external) {
          return resolution;
        }
        recordAppliedHint(`package:${hintKey}`, hint.score);
        return {
          namespace: PREVIEW_COMPILER_PRIVATE_NAMESPACES.dependencyPackageHint,
          path: arguments_.path,
          sideEffects: false,
          warnings: [
            ...resolution.warnings,
            {
              text:
                `React Preview used cooperating deterministic and neural dependency hints to ` +
                `replace unavailable server package "${arguments_.path}" with a neutral browser contract.`,
            },
          ],
        };
      }

      /** Reports each applied fallback once; the compiler supplies the eventual build label. */
      function recordAppliedHint(
        hintKey: string,
        score: PreviewDependencyResolutionNeuralScore | undefined,
      ): void {
        if (score === undefined || recordedOutcomes.has(hintKey)) return;
        recordedOutcomes.add(hintKey);
        options.onHintApplied?.(score);
      }

      /** Loads one still-marked server source through its inert browser execution contract. */
      async function loadHintedServerContract(
        arguments_: OnLoadArgs,
      ): Promise<OnLoadResult | undefined> {
        if (arguments_.namespace !== 'file' || !SOURCE_FILTER.test(arguments_.path)) {
          return undefined;
        }
        const sourcePath = canonicalizeHintPath(arguments_.path, workspaceRoot);
        if (sourcePath === undefined || !hintedPaths.has(sourcePath)) return undefined;
        const sourceText = await readHintedSource(sourcePath, options.readSource);
        // Revalidate the deterministic admission evidence on every rebuild. A stale neural hint is
        // never enough to turn a newly edited browser module into a facade.
        if (sourceText === undefined || !hasExplicitServerBoundary(sourceText)) {
          return undefined;
        }
        const facadeHint = facadeHintByPath.get(sourcePath);
        const contractExamples = (facadeHint?.contractExamples ?? []).filter(
          (example) => canonicalizeHintPath(example.sourcePath, workspaceRoot) === sourcePath,
        );
        const evidenceWatchFiles = [
          ...new Set(
            (
              facadeHint?.evidenceSourcePaths ??
              contractExamples.map((item) => item.evidenceSourcePath)
            )
              .map((evidencePath) => canonicalizeHintPath(evidencePath, workspaceRoot))
              .filter((evidencePath): evidencePath is string => evidencePath !== undefined),
          ),
        ].sort();
        recordAppliedHint(`facade:${sourcePath}`, facadeHint?.score);
        const exportNames = collectPreviewRenderModuleFacts(sourcePath, sourceText).exports.flatMap(
          (item) => (item.wildcard ? [] : [item.exportName]),
        );
        const typedExportExpressions = new Map<string, string>();
        for (const exportName of exportNames) {
          const learned = contractExamples.find((example) => example.exportName === exportName);
          if (learned !== undefined && learned.mode !== 'returned-undefined') continue;
          const typed = options.readTypedExportExpression?.(sourcePath, exportName);
          // A bare mock's `undefined` stays when the declared result admits it (`string | null`).
          if (typed === undefined || (learned !== undefined && typed.nullableResult)) continue;
          typedExportExpressions.set(exportName, typed.expression);
        }
        return {
          contents: createPreviewServerContractFacadeSource(
            sourcePath,
            workspaceRoot,
            exportNames,
            contractExamples,
            typedExportExpressions,
          ),
          loader: 'js',
          resolveDir: path.dirname(sourcePath),
          warnings: [
            {
              text:
                `React Preview used a neural dependency hint to expose the explicit server module ` +
                `"${formatWorkspacePath(sourcePath, workspaceRoot)}" as a render-only execution contract.`,
            },
          ],
          watchFiles: [sourcePath, ...evidenceWatchFiles],
        };
      }

      if (styleHints.size > 0) {
        build.onResolve(
          { filter: createHintSpecifierFilter(styleHintSpecifiers) },
          resolveHintedStyleContract,
        );
      }
      if (packageContractHints.size > 0) {
        build.onResolve(
          { filter: createHintSpecifierFilter(packageHintSpecifiers) },
          resolveHintedPackageContract,
        );
      }
      if (hintedPaths.size > 0) {
        build.onLoad({ filter: SOURCE_FILTER, namespace: 'file' }, loadHintedServerContract);
      }
      build.onLoad(
        {
          filter: /.*/,
          namespace: PREVIEW_COMPILER_PRIVATE_NAMESPACES.dependencyPackageHint,
        },
        (arguments_) => ({
          contents: createPreviewPackageContractFacadeSource(arguments_.path),
          loader: 'js',
        }),
      );
      build.onLoad(
        {
          filter: /.*/,
          namespace: PREVIEW_COMPILER_PRIVATE_NAMESPACES.dependencyStyleHint,
        },
        () => ({ contents: '', loader: 'css' }),
      );
    },
  };
}

/**
 * Narrows native callback delivery to exact literal requests, without caching filesystem answers.
 * Printable ASCII has a common literal syntax in JavaScript and esbuild's Go regexp engine.
 * Other or unusually large inputs retain the broad filter and exact set check in the callback.
 */
function createHintSpecifierFilter(specifiers: ReadonlySet<string>): RegExp {
  const escaped: string[] = [];
  let patternLength = 0;
  for (const specifier of specifiers) {
    if (/[^\x20-\x7e]/u.test(specifier)) return /.*/;
    const literal = specifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    patternLength += literal.length + 1;
    if (patternLength > 16_384) return /.*/;
    escaped.push(literal);
  }
  return new RegExp(`^(?:${escaped.join('|')})$`);
}

/** Reports whether authored source explicitly opts into a server execution boundary. */
export function hasExplicitPreviewServerBoundary(sourceText: string): boolean {
  return hasExplicitServerBoundary(sourceText);
}

/**
 * Creates a CommonJS proxy so esbuild can satisfy arbitrary named ESM imports from the contract.
 * Calls and property chains remain inert and non-thenable; runtime blocker inference can then
 * recommend the concrete values required by the consuming page instead of loading server code.
 * Timestamp-named properties are the exception: an ending-state timestamp (`deletedAt`) reads as
 * `null`, so tombstone and deletion notices stay closed, and others read as today's `Date`. Prisma
 * query methods (`findUnique`, `groupBy`, `$transaction`, …) return a promise of the neutral value,
 * so `.then(…)` chains work as they do on a real `PrismaPromise`.
 */
export function createPreviewServerContractFacadeSource(
  sourcePath: string,
  workspaceRoot: string,
  exportNames: readonly string[] = [],
  contractExamples: readonly PreviewLearnedServerContractExample[] = [],
  typedExportExpressions: ReadonlyMap<string, string> = new Map(),
): string {
  const label = formatWorkspacePath(sourcePath, workspaceRoot);
  return createPreviewNeutralExecutionContractSource(
    'explicit server module',
    label,
    `[React Preview] Server execution contract ${label} is using a neural dependency hint.`,
    exportNames,
    contractExamples,
    typedExportExpressions,
  );
}

/** Creates a callable, property-chain-safe browser contract for one unavailable server package. */
export function createPreviewPackageContractFacadeSource(moduleSpecifier: string): string {
  return createPreviewNeutralExecutionContractSource(
    'server package',
    moduleSpecifier,
    `[React Preview] Server package ${moduleSpecifier} is using a neutral dependency contract.`,
  );
}

/** Emits the shared inert CommonJS contract used by source and package recovery boundaries. */
function createPreviewNeutralExecutionContractSource(
  contractKind: string,
  label: string,
  warning: string,
  exportNames?: readonly string[],
  contractExamples: readonly PreviewLearnedServerContractExample[] = [],
  typedExportExpressions: ReadonlyMap<string, string> = new Map(),
): string {
  const namedExports = [
    ...new Set(
      (exportNames ?? []).filter(
        (exportName) => exportName !== 'default' && /^[$A-Z_a-z][$\w]*$/u.test(exportName),
      ),
    ),
  ].sort();
  const hasDefaultExport = exportNames?.includes('default') === true;
  const learnedExampleByExport = new Map(
    contractExamples
      .filter((example) => exportNames?.includes(example.exportName) === true)
      .map((example) => [example.exportName, example] as const),
  );
  return [
    `/** Render-only execution contract for ${contractKind}: ${label.replaceAll('*/', '* /')} */`,
    'const maximumDepth = 10;',
    'const values = [];',
    '// Ending-state timestamps read as absent; other timestamp names read as today.',
    `const lifecycleEndTimestamp = ${String(PREVIEW_LIFECYCLE_END_TIMESTAMP_PATTERN)};`,
    `const ordinaryTimestamp = ${String(PREVIEW_TIMESTAMP_NAME_PATTERN)};`,
    'const accessorName = /^(?:get|set|to)[A-Z]/u;',
    `const readSampleInstant = () => new Date(${createPreviewSampleDateRebaseExpression(PREVIEW_CANONICAL_SAMPLE_DATE_TIME)});`,
    '// Prisma query methods return promises (PrismaPromise); here they settle to the neutral value.',
    `const queryMethodName = ${String(PREVIEW_PRISMA_QUERY_METHOD_PATTERN)};`,
    'const queryMethods = [];',
    'const readQueryMethod = (depth) => {',
    '  if (queryMethods[depth] !== undefined) return queryMethods[depth];',
    '  const method = new Proxy(function ReactPreviewServerQuery() {}, {',
    '    apply() { return Promise.resolve(readValue(depth)); },',
    "    get(target, property) { return property === 'name' ? 'Query' : readValue(depth)[property]; },",
    '  });',
    '  queryMethods[depth] = method;',
    '  return method;',
    '};',
    'const readValue = (depth) => {',
    '  if (values[depth] !== undefined) return values[depth];',
    '  const next = () => depth < maximumDepth ? readValue(depth + 1) : undefined;',
    '  const callable = function ReactPreviewServerContract() { return next(); };',
    '  const value = new Proxy(callable, {',
    '    apply() { return next(); },',
    '    construct() { return next() ?? Object.create(null); },',
    '    get(target, property, receiver) {',
    "      if (property === '__esModule') return false;",
    "      if (property === 'then') return undefined;",
    "      if (property === 'toJSON') return () => ({});",
    '      if (property === Symbol.iterator) return () => [][Symbol.iterator]();',
    "      if (property === 'map' || property === 'flatMap') return () => [];",
    "      if (property === 'filter' || property === 'slice') return () => [];",
    "      if (property === Symbol.toPrimitive) return (hint) => hint === 'number' ? 0 : 'Preview value';",
    "      // The callable target's own `name` is internal; data reads get the sample label.",
    `      if (property === 'name') return ${JSON.stringify(createPreviewSampleLabel('name'))};`,
    '      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);',
    "      if (typeof property === 'string' && lifecycleEndTimestamp.test(property)) return null;",
    "      if (typeof property === 'string' && ordinaryTimestamp.test(property) && !accessorName.test(property)) return readSampleInstant();",
    "      if (typeof property === 'string' && queryMethodName.test(property)) return readQueryMethod(Math.min(depth + 1, maximumDepth));",
    '      return next();',
    '    },',
    '    has(target, property) { return Reflect.has(target, property); },',
    '    set() { return true; },',
    '  });',
    '  values[depth] = value;',
    '  return value;',
    '};',
    'const contract = readValue(0);',
    `console.warn(${JSON.stringify(warning)});`,
    ...(exportNames === undefined || exportNames.length === 0
      ? ['module.exports = contract;']
      : [
          ...(hasDefaultExport
            ? [
                `export default ${createLearnedContractFunctionSource(
                  learnedExampleByExport.get('default'),
                  typedExportExpressions.get('default'),
                )};`,
              ]
            : []),
          ...namedExports.map(
            (exportName) =>
              `export const ${exportName} = ${createLearnedContractFunctionSource(
                learnedExampleByExport.get(exportName),
                typedExportExpressions.get(exportName),
              )};`,
          ),
        ]),
  ].join('\n');
}

/**
 * Emits one export's contract: a learned mock value first, then a function built from the
 * export's declared type, then a bare mock's `undefined`, then the property-chain-safe proxy.
 */
function createLearnedContractFunctionSource(
  example: PreviewLearnedServerContractExample | undefined,
  typedExpression?: string,
): string {
  if (
    typedExpression !== undefined &&
    (example === undefined || example.mode === 'returned-undefined')
  ) {
    return typedExpression;
  }
  if (example === undefined) return PREVIEW_SERVER_CONTRACT_NEUTRAL_VALUE_EXPRESSION;
  if (example.mode === 'returned-undefined') return '() => undefined';
  const serializedValue = JSON.stringify(example.value);
  return example.mode === 'resolved'
    ? `() => Promise.resolve(${serializedValue})`
    : `() => (${serializedValue})`;
}

/** Checks only a bounded source prefix for an authored server execution boundary. */
function hasExplicitServerBoundary(sourceText: string): boolean {
  const boundedSource = sourceText.slice(0, 64 * 1024);
  return (
    SERVER_ONLY_IMPORT_PATTERN.test(boundedSource) ||
    USE_SERVER_DIRECTIVE_PATTERN.test(boundedSource)
  );
}

/** Reads a current editor overlay first and safely falls back to the real source file. */
async function readHintedSource(
  sourcePath: string,
  readSource: PreviewDependencyResolutionHintPluginOptions['readSource'],
): Promise<string | undefined> {
  try {
    const supplied = await readSource?.(sourcePath);
    return supplied ?? (await readFile(sourcePath, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Admits only absolute, canonical paths confined to the active workspace. */
function canonicalizeHintPath(sourcePath: string, workspaceRoot: string): string | undefined {
  if (!path.isAbsolute(sourcePath)) return undefined;
  const canonicalPath = canonicalizeExistingPath(sourcePath);
  const relativePath = path.relative(workspaceRoot, canonicalPath);
  return relativePath.length === 0 ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
    ? canonicalPath
    : undefined;
}

/** Produces a stable workspace-relative diagnostic label without exposing unrelated host paths. */
function formatWorkspacePath(sourcePath: string, workspaceRoot: string): string {
  const relativePath = path.relative(workspaceRoot, sourcePath);
  return relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
    ? relativePath.split(path.sep).join('/')
    : path.basename(sourcePath);
}

/** Binds a dependency fallback to both its authored importer and exact bare module request. */
function createHintKey(sourcePath: string, moduleSpecifier: string): string {
  return `${sourcePath}\0${moduleSpecifier}`;
}
