/**
 * Preflights an optional Storybook preview before the expensive target bundle is started.
 *
 * Automatic Storybook reuse is helpful but must not double the initial render time when its own
 * entry file contains an obviously missing local import. This module examines only direct runtime
 * imports from that entry. Nested and package resolution remain esbuild's responsibility so this
 * fast path cannot grow into another project-wide analyzer.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { PreviewDiagnostic, PreviewSourceSnapshot } from '../../domain/preview';
import { throwIfPreviewBuildCancelled } from '../../domain/previewBuildExecution';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { createPreviewBuildPlanIdentity } from './previewBuildPlanIdentity';
import type {
  PreviewRuntimeEnvironment,
  PreviewRuntimeWatchInputs,
} from './previewRuntimeEnvironment';
import type { PreviewSetupFailureCache, PreviewSetupFailurePlan } from './previewSetupFailureCache';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';

const RUNTIME_SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?|json)$/iu;
const RUNTIME_SOURCE_CANDIDATE_EXTENSIONS = [
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mts',
  '.mjs',
  '.cts',
  '.cjs',
  '.json',
] as const;

/** Inputs that are already available after static module-resolution preparation. */
export interface PrepareAutomaticPreviewSetupFallbackOptions {
  /** Compiler-lifetime evidence cache shared by preview tabs. */
  readonly cache: PreviewSetupFailureCache;
  /** Unsaved editor sources used instead of stale setup files when available. */
  readonly dependencySnapshots: readonly PreviewSourceSnapshot[];
  /** Human-readable target filename for the warning. */
  readonly documentName: string;
  /** Nearest package boundary used in the stable cache identity. */
  readonly projectRoot: string;
  /** Runtime setup selected by convention/config discovery. */
  readonly runtimeEnvironment: PreviewRuntimeEnvironment;
  /** Existing setup/bootstrap liveness inputs merged into the cached fallback. */
  readonly runtimeWatchInputs: PreviewRuntimeWatchInputs;
  /** Cancellation signal owned by the current preview revision. */
  readonly signal?: AbortSignal;
  /** TypeScript-compatible resolver already initialized for the target workspace. */
  readonly staticModuleResolver: Pick<PreviewStaticModuleResolver, 'resolve'>;
  /** Trusted workspace boundary for missing-candidate paths and watchers. */
  readonly workspaceRoot: string;
}

/** Setup-free build selection and its one-time user-facing diagnostic. */
export interface PreparedAutomaticPreviewSetupFallback {
  /** Stable key reused if a deeper setup import later fails inside esbuild. */
  readonly cacheKey?: string;
  /** Empty for a usable setup, otherwise exact recovery evidence. */
  readonly plan?: PreviewSetupFailurePlan;
  /** Warning emitted only when the direct failure is first discovered. */
  readonly diagnostics: readonly PreviewDiagnostic[];
}

/**
 * Reuses a known fallback or detects one missing direct Storybook runtime import.
 *
 * @returns Setup-free plan when safe preflight evidence proves the optional entry cannot bundle.
 */
export async function prepareAutomaticPreviewSetupFallback(
  options: PrepareAutomaticPreviewSetupFallbackOptions,
): Promise<PreparedAutomaticPreviewSetupFallback> {
  const setupModulePath = options.runtimeEnvironment.setupModulePath;
  if (options.runtimeEnvironment.setupKind !== 'storybook' || setupModulePath === undefined) {
    return { diagnostics: [] };
  }
  const cacheKey = createPreviewBuildPlanIdentity({
    projectRoot: options.projectRoot,
    setupModulePath,
    workspaceRoot: options.workspaceRoot,
  });
  const cached = await options.cache.read(cacheKey, options.dependencySnapshots, options.signal);
  if (cached !== undefined) {
    return { cacheKey, diagnostics: [], plan: cached };
  }
  const preflight = await preflightDirectStorybookImports({
    dependencySnapshots: options.dependencySnapshots,
    documentName: options.documentName,
    resolveModule: options.staticModuleResolver.resolve,
    setupModulePath,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    workspaceRoot: options.workspaceRoot,
  });
  if (preflight === undefined) {
    return { cacheKey, diagnostics: [] };
  }
  const plan = {
    ...preflight,
    dependencyPaths: [
      ...new Set([...preflight.dependencyPaths, ...options.runtimeWatchInputs.dependencyPaths]),
    ].sort(),
  };
  await options.cache.write(cacheKey, plan, options.dependencySnapshots, options.signal);
  return {
    cacheKey,
    diagnostics: [{ message: plan.diagnosticMessage, severity: 'warning' }],
    plan,
  };
}

/** Minimal direct-import preflight inputs kept private to this adapter. */
interface DirectStorybookPreflightOptions {
  readonly dependencySnapshots: readonly PreviewSourceSnapshot[];
  readonly documentName: string;
  readonly resolveModule: PreviewStaticModuleResolver['resolve'];
  readonly setupModulePath: string;
  readonly signal?: AbortSignal;
  readonly workspaceRoot: string;
}

/** Returns the first trackable direct failure, leaving complex graphs to the native bundler. */
async function preflightDirectStorybookImports(
  options: DirectStorybookPreflightOptions,
): Promise<PreviewSetupFailurePlan | undefined> {
  throwIfPreviewBuildCancelled(options.signal);
  const setupModulePath = canonicalizeExistingPath(options.setupModulePath);
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const sourceText = await readSetupSource(
    setupModulePath,
    options.dependencySnapshots,
    options.signal,
  );
  if (sourceText === undefined) return undefined;
  for (const specifier of collectDirectRuntimeModuleSpecifiers(setupModulePath, sourceText)) {
    if (!isPreflightableLocalSource(specifier)) continue;
    if (options.resolveModule(specifier, setupModulePath) !== undefined) continue;
    const dependencyPaths = createMissingSourceCandidatePaths(
      setupModulePath,
      specifier,
      workspaceRoot,
    );
    if (dependencyPaths.length === 0) continue;
    const watchDirectory = await findExistingWatchDirectory(
      path.dirname(path.resolve(path.dirname(setupModulePath), specifier)),
      workspaceRoot,
    );
    return {
      dependencyPaths: [setupModulePath, ...dependencyPaths],
      diagnosticMessage: `Automatic Storybook preview setup was skipped for ${options.documentName} because direct setup import "${specifier}" could not be resolved. React Preview will retry when that source appears or the setup changes.`,
      watchDirectories: watchDirectory === undefined ? [] : [watchDirectory],
    };
  }
  throwIfPreviewBuildCancelled(options.signal);
  return undefined;
}

/** Reads the latest editor overlay for setup, otherwise its current filesystem contents. */
async function readSetupSource(
  setupModulePath: string,
  snapshots: readonly PreviewSourceSnapshot[],
  signal?: AbortSignal,
): Promise<string | undefined> {
  const normalizedPath = path.normalize(setupModulePath);
  const snapshot = [...snapshots]
    .reverse()
    .find((candidate) => path.normalize(candidate.documentPath) === normalizedPath);
  if (snapshot !== undefined) return snapshot.sourceText;
  try {
    return await readFile(setupModulePath, { encoding: 'utf8', signal });
  } catch {
    return undefined;
  }
}

/** Parses only real runtime import/export/require expressions, excluding comments and type imports. */
function collectDirectRuntimeModuleSpecifiers(
  setupModulePath: string,
  sourceText: string,
): readonly string[] {
  const sourceFile = ts.createSourceFile(
    setupModulePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    setupModulePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && !isTypeOnlyImport(node)) {
      appendStringLiteral(node.moduleSpecifier, specifiers);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      appendStringLiteral(node.moduleSpecifier, specifiers);
    } else if (ts.isCallExpression(node) && isRuntimeModuleCall(node)) {
      appendStringLiteral(node.arguments[0], specifiers);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(specifiers)];
}

/** Reports whether an import clause contributes any runtime binding or side effect. */
function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return true;
  if (clause?.name !== undefined || clause?.namedBindings === undefined) return false;
  return (
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

/** Recognizes dynamic import and CommonJS require with a literal first argument. */
function isRuntimeModuleCall(node: ts.CallExpression): boolean {
  return (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === 'require')
  );
}

/** Appends one ordinary string literal without accepting computed template expressions. */
function appendStringLiteral(node: ts.Node | undefined, output: string[]): void {
  if (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    output.push(node.text);
  }
}

/** Limits preflight to relative JS/TS/JSON sources that the static resolver can prove. */
function isPreflightableLocalSource(specifier: string): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const extension = path.extname(specifier);
  return extension.length === 0 || RUNTIME_SOURCE_EXTENSION_PATTERN.test(extension);
}

/** Enumerates exact missing module candidates retained for hot-reload recovery. */
function createMissingSourceCandidatePaths(
  importerPath: string,
  specifier: string,
  workspaceRoot: string,
): readonly string[] {
  const basePath = path.resolve(path.dirname(importerPath), specifier);
  const extension = path.extname(basePath);
  const candidates =
    extension.length > 0
      ? [basePath]
      : RUNTIME_SOURCE_CANDIDATE_EXTENSIONS.flatMap((candidateExtension) => [
          basePath + candidateExtension,
          path.join(basePath, 'index' + candidateExtension),
        ]);
  return candidates.filter((candidate) => isPathInside(workspaceRoot, candidate));
}

/** Finds the nearest existing directory that can observe creation of a missing candidate. */
async function findExistingWatchDirectory(
  startDirectory: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  let current = path.resolve(startDirectory);
  while (isPathInside(workspaceRoot, current)) {
    try {
      if ((await stat(current)).isDirectory()) return canonicalizeExistingPath(current);
    } catch {
      // Walk upward until a stable existing watch root is found.
    }
    if (path.normalize(current) === path.normalize(workspaceRoot)) break;
    current = path.dirname(current);
  }
  return undefined;
}

/** Confines lexical future paths to the trusted workspace. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
