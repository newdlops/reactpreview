/**
 * Connects an editor-selected non-component module to one real Next App Router page.
 *
 * Lower-camel registries, provider helpers, hook modules, and MDX component maps frequently have no
 * renderable export of their own. Page Inspector still needs an honest browser root for them: this
 * planner follows static imports from authored `page` modules, chooses one bounded shortest path,
 * and composes only that page's implicit layout chain. No project module is evaluated in the host.
 */
import path from 'node:path';
import ts from 'typescript';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import type { PreviewRenderChainPlan, ResolvePreviewRenderGraphModule } from '../renderGraph';
import {
  freezePreviewInspectorAncestorPlan,
  freezePreviewInspectorPageCandidate,
} from './previewInspectorAncestorFreezing';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorTypes';
import {
  collectPreviewInspectorNextAppLayoutChain,
  createPreviewInspectorNextAppModuleIndex,
  type PreviewInspectorNextAppLayoutChain,
} from './previewInspectorNextAppLayoutChain';
import { collectRefinedPreviewInspectorNextAppLayoutChain } from './previewInspectorNextAppParameterEvidence';
import { inferPreviewInspectorNextAppTargetPathParams } from './previewInspectorNextAppTargetPathParams';

const NEXT_APP_PAGE_PATTERN = /^page\.[cm]?[jt]sx?$/iu;
const NEXT_APP_ROUTE_STATE_PATTERN = /^(?:error|loading|not-found)\.[cm]?[jt]sx?$/iu;
const MAXIMUM_PAGE_STARTS = 512;
const MAXIMUM_MODULE_VISITS = 2_048;
const MAXIMUM_IMPORTS_PER_MODULE = 512;
const MAXIMUM_COLLECTED_IMPORTS_PER_MODULE = 4_096;
const MAXIMUM_TOTAL_SOURCE_BYTES = 32 * 1024 * 1024;

/** Snapshot-aware inputs supplied from the compiler's existing package inventory and file cache. */
export interface CreatePreviewInspectorNextAppModulePagePlanOptions {
  /**
   * Component export selected inside a lazy registry. When present, nested instrumentation keeps
   * this exact target instead of describing the selected file as a non-rendering context module.
   */
  readonly componentTargetExportName?: string;
  /** Absolute non-component module selected by the editor command. */
  readonly documentPath: string;
  /** Reads current editor or disk source under the caller's established byte ceiling. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Project-aware resolver for relative, alias, package-source, and re-export edges. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Cancels stale page discovery between source reads and bounded import traversal steps. */
  readonly signal?: AbortSignal;
  /** Existing nearest-package source inventory; this planner never walks the filesystem itself. */
  readonly sourcePaths: readonly string[];
}

/** One proven page-to-selected-module path retained before the browser-safe plan is assembled. */
interface ModulePageEvidence {
  readonly evidenceKind: 'import-chain';
  readonly importPath: readonly string[];
  readonly pagePath: string;
}

/** One bounded best-first traversal item with a parent pointer instead of copied path arrays. */
interface PendingModulePath {
  readonly parentIndex?: number;
  readonly pagePath: string;
  readonly sourcePath: string;
}

/** One resolved authored dependency preserving whether the source deferred its evaluation. */
interface ResolvedModuleImport {
  readonly deferred: boolean;
  readonly sourcePath: string;
}

/** Parsed string-literal module edge before project-aware path resolution. */
interface RuntimeModuleSpecifier {
  readonly deferred: boolean;
  readonly value: string;
}

/**
 * Finds and freezes one consuming App Router page for a module without a component-shaped export.
 *
 * Static import evidence wins over deferred imports. The returned dependency list contains only
 * the selected path and layouts so the corridor plugin can still collapse unrelated generated
 * dynamic registries.
 */
export async function createPreviewInspectorNextAppModulePagePlan(
  options: CreatePreviewInspectorNextAppModulePagePlanOptions,
): Promise<PreviewInspectorAncestorPlan | undefined> {
  throwIfPreviewBuildCancelled(options.signal);
  const documentPath = path.normalize(options.documentPath);
  const sourcePaths = [...new Set(options.sourcePaths.map((item) => path.normalize(item)))].sort();
  const authoredPaths = createAuthoredPathIndex([...sourcePaths, documentPath]);
  const targetIdentity = createModuleIdentity(documentPath);
  const nextAppSourceIndex = createPreviewInspectorNextAppModuleIndex(sourcePaths);
  const candidatePagePaths = sourcePaths
    .filter((sourcePath) => NEXT_APP_PAGE_PATTERN.test(path.basename(sourcePath)))
    .sort((left, right) => comparePageAffinity(documentPath, left, right));
  const pageShellByPath = new Map<string, PreviewInspectorNextAppLayoutChain>();
  for (const pagePath of candidatePagePaths) {
    if (pageShellByPath.size >= MAXIMUM_PAGE_STARTS) break;
    const shell = collectPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      sourceIndex: nextAppSourceIndex,
      sourcePaths,
    });
    if (shell !== undefined) pageShellByPath.set(pagePath, shell);
  }
  const pages = [...pageShellByPath.keys()];
  if (pages.length === 0) return undefined;

  const importsByPath = new Map<string, Promise<readonly ResolvedModuleImport[]>>();
  const admittedSourceBytesByPath = new Map<string, number>();
  let admittedSourceBytes = 0;
  const routeStatePage = selectNextAppRouteStatePage(documentPath, pages);
  if (routeStatePage !== undefined) return createRouteStatePagePlan(routeStatePage);
  const evidence = (await findImportedModulePage(false)) ?? (await findImportedModulePage(true));
  if (evidence === undefined) return undefined;
  throwIfPreviewBuildCancelled(options.signal);

  const initialShell = pageShellByPath.get(evidence.pagePath);
  if (initialShell === undefined) return undefined;
  const targetParameterValues =
    options.componentTargetExportName === undefined
      ? undefined
      : inferPreviewInspectorNextAppTargetPathParams({
          routePattern: initialShell.routeLocation.pattern,
          targetPath: documentPath,
        });

  const refinement = await collectRefinedPreviewInspectorNextAppLayoutChain({
    ...(targetParameterValues === undefined
      ? {}
      : { dynamicParameterValues: targetParameterValues }),
    exportName: 'default',
    pagePath: evidence.pagePath,
    readSource: readCachedSource,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourceIndex: nextAppSourceIndex,
    sourcePaths,
  });
  const shell = refinement?.shell ?? initialShell;
  const pageRoot = Object.freeze({ exportName: 'default', sourcePath: evidence.pagePath });
  const target =
    options.componentTargetExportName === undefined
      ? pageRoot
      : Object.freeze({
          exportName: options.componentTargetExportName,
          sourcePath: documentPath,
        });
  const dependencies = new Set<string>([
    documentPath,
    ...evidence.importPath,
    ...(refinement?.dependencyPaths ?? []),
    ...shell.layouts.map((layout) => layout.sourcePath),
  ]);
  const renderChain: PreviewRenderChainPlan = Object.freeze({
    dependencyPaths: Object.freeze([...dependencies].sort()),
    paths:
      options.componentTargetExportName === undefined
        ? Object.freeze([])
        : Object.freeze([
            Object.freeze({
              id: `next-app-lazy-component:${evidence.importPath.join('>')}`,
              steps: Object.freeze(
                [...evidence.importPath].reverse().map((sourcePath, index) =>
                  Object.freeze({
                    certainty: 'confirmed' as const,
                    kind: index === 0 ? ('react-lazy' as const) : ('value-flow' as const),
                    label: path.basename(sourcePath).replace(/\.[^.]+$/u, ''),
                    occurrenceStart: 0,
                    sourcePath,
                    wrapperNames: Object.freeze([]),
                  }),
                ),
              ),
            }),
          ]),
    reachability: 'entry-unreachable',
    stopReason: 'entry-unreachable',
    target,
    truncated: candidatePagePaths.length > MAXIMUM_PAGE_STARTS,
  });
  const emptyProps = Object.freeze({});
  const candidate = freezePreviewInspectorPageCandidate({
    complete: true,
    dependencies,
    edges: Object.freeze([]),
    id: `next-app-module-context:${evidence.pagePath}`,
    renderPath: undefined,
    root: pageRoot,
    rootAutomaticProps: emptyProps,
    nextAppLayoutChain: shell.layouts,
    rootOwnsRouter: false,
    routeLocation: shell.routeLocation,
    stopReason: 'root-reached',
    targetAutomaticProps: emptyProps,
  });
  return freezePreviewInspectorAncestorPlan({
    complete: true,
    ...(options.componentTargetExportName === undefined
      ? {
          contextModule: Object.freeze({
            evidenceKind: evidence.evidenceKind,
            importPath: Object.freeze([...evidence.importPath]),
            sourcePath: documentPath,
          }),
        }
      : {}),
    dependencies,
    edges: Object.freeze([]),
    pageCandidates: Object.freeze([candidate]),
    root: pageRoot,
    rootAutomaticProps: emptyProps,
    renderChain,
    renderChainsByExport: Object.freeze({ [target.exportName]: renderChain }),
    renderOutcomesByExport: Object.freeze({}),
    stopReason: 'root-reached',
    target,
    targetAutomaticProps: emptyProps,
  });

  /** Mounts a Next loading/error/not-found component inside the page branch it replaces. */
  async function createRouteStatePagePlan(
    pagePath: string,
  ): Promise<PreviewInspectorAncestorPlan | undefined> {
    const initialShell = pageShellByPath.get(pagePath);
    if (initialShell === undefined) return undefined;
    const refinement = await collectRefinedPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      readSource: readCachedSource,
      resolveModule: options.resolveModule,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      sourceIndex: nextAppSourceIndex,
      sourcePaths,
    });
    const shell = refinement?.shell ?? initialShell;
    const target = Object.freeze({ exportName: 'default', sourcePath: documentPath });
    const dependencies = new Set<string>([
      documentPath,
      pagePath,
      ...(refinement?.dependencyPaths ?? []),
      ...shell.layouts.map((layout) => layout.sourcePath),
    ]);
    const renderChain: PreviewRenderChainPlan = Object.freeze({
      dependencyPaths: Object.freeze([...dependencies].sort()),
      paths: Object.freeze([]),
      reachability: 'entry-unreachable',
      stopReason: 'entry-unreachable',
      target,
      truncated: candidatePagePaths.length > MAXIMUM_PAGE_STARTS,
    });
    const emptyProps = Object.freeze({});
    const candidate = freezePreviewInspectorPageCandidate({
      complete: true,
      dependencies,
      edges: Object.freeze([]),
      id: `next-app-route-state:${documentPath}:${pagePath}`,
      renderPath: undefined,
      root: target,
      rootAutomaticProps: emptyProps,
      nextAppLayoutChain: shell.layouts,
      rootOwnsRouter: false,
      routeLocation: shell.routeLocation,
      stopReason: 'root-reached',
      targetAutomaticProps: emptyProps,
    });
    return freezePreviewInspectorAncestorPlan({
      complete: true,
      dependencies,
      edges: Object.freeze([]),
      pageCandidates: Object.freeze([candidate]),
      root: target,
      rootAutomaticProps: emptyProps,
      renderChain,
      renderChainsByExport: Object.freeze({ default: renderChain }),
      renderOutcomesByExport: Object.freeze({}),
      stopReason: 'root-reached',
      target,
      targetAutomaticProps: emptyProps,
    });
  }

  /** Reads and parses one module's literal imports once during this planner invocation. */
  function readResolvedImports(sourcePath: string): Promise<readonly ResolvedModuleImport[]> {
    const normalizedPath = path.normalize(sourcePath);
    const cached = importsByPath.get(normalizedPath);
    if (cached !== undefined) return cached;
    const pending = readCachedSource(normalizedPath).then((sourceText) => {
      if (sourceText === undefined) return Object.freeze([]);
      const resolved: ResolvedModuleImport[] = [];
      const seen = new Set<string>();
      for (const moduleSpecifier of collectRuntimeModuleSpecifiers(
        normalizedPath,
        sourceText,
        documentPath,
      )) {
        const resolvedPath = options.resolveModule(moduleSpecifier.value, normalizedPath);
        if (resolvedPath === undefined) continue;
        const authoredPath = resolveAuthoredPath(authoredPaths, resolvedPath);
        if (authoredPath === undefined) continue;
        const key = `${moduleSpecifier.deferred ? 'deferred' : 'static'}:${authoredPath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        resolved.push({ deferred: moduleSpecifier.deferred, sourcePath: authoredPath });
      }
      return Object.freeze(resolved);
    });
    importsByPath.set(normalizedPath, pending);
    return pending;
  }

  /** Applies one planner-wide byte ceiling without retaining source strings after each parse. */
  async function readCachedSource(sourcePath: string): Promise<string | undefined> {
    const normalizedPath = path.normalize(sourcePath);
    const sourceText = await options.readSource(normalizedPath);
    if (sourceText === undefined) return undefined;
    if (!admittedSourceBytesByPath.has(normalizedPath)) {
      const byteLength = Buffer.byteLength(sourceText, 'utf8');
      if (admittedSourceBytes + byteLength > MAXIMUM_TOTAL_SOURCE_BYTES) return undefined;
      admittedSourceBytes += byteLength;
      admittedSourceBytesByPath.set(normalizedPath, byteLength);
    }
    return sourceText;
  }

  /** Multi-source traversal finds a static path first and only then admits deferred imports. */
  async function findImportedModulePage(
    includeDeferred: boolean,
  ): Promise<ModulePageEvidence | undefined> {
    const pending: PendingModulePath[] = [];
    const enqueued = new Set<string>();
    const pageIndexByPath = new Map<string, number>();
    for (const pagePath of pages) {
      if (pending.length >= MAXIMUM_MODULE_VISITS) break;
      const pageIdentity = createModuleIdentity(pagePath);
      if (enqueued.has(pageIdentity)) continue;
      enqueued.add(pageIdentity);
      const pageIndex = pending.push({ pagePath, sourcePath: pagePath }) - 1;
      pageIndexByPath.set(pagePath, pageIndex);
    }
    for (const pagePath of pages) {
      const pageIndex = pageIndexByPath.get(pagePath);
      if (pageIndex === undefined) continue;
      for (const layout of pageShellByPath.get(pagePath)?.layouts ?? []) {
        if (pending.length >= MAXIMUM_MODULE_VISITS) break;
        const layoutIdentity = createModuleIdentity(layout.sourcePath);
        if (enqueued.has(layoutIdentity)) continue;
        enqueued.add(layoutIdentity);
        pending.push({
          pagePath,
          parentIndex: pageIndex,
          sourcePath: path.normalize(layout.sourcePath),
        });
      }
    }
    let pendingIndex = 0;
    while (pendingIndex < pending.length && pendingIndex < MAXIMUM_MODULE_VISITS) {
      throwIfPreviewBuildCancelled(options.signal);
      const current = pending[pendingIndex];
      const currentIndex = pendingIndex;
      pendingIndex += 1;
      if (current === undefined) break;
      for (const dependency of await readResolvedImports(current.sourcePath)) {
        if (dependency.deferred && !includeDeferred) continue;
        const dependencyIdentity = createModuleIdentity(dependency.sourcePath);
        if (dependencyIdentity === targetIdentity) {
          return {
            evidenceKind: 'import-chain',
            importPath: Object.freeze([
              ...reconstructModulePath(pending, currentIndex),
              dependency.sourcePath,
            ]),
            pagePath: current.pagePath,
          };
        }
        if (enqueued.has(dependencyIdentity) || pending.length >= MAXIMUM_MODULE_VISITS) continue;
        enqueued.add(dependencyIdentity);
        pending.push({
          pagePath: current.pagePath,
          parentIndex: currentIndex,
          sourcePath: dependency.sourcePath,
        });
      }
    }
    return undefined;
  }
}

/** Chooses only an equal-or-descendant page whose subtree owns a conventional route-state file. */
function selectNextAppRouteStatePage(
  documentPath: string,
  pages: readonly string[],
): string | undefined {
  if (!NEXT_APP_ROUTE_STATE_PATTERN.test(path.basename(documentPath))) return undefined;
  const stateDirectory = path.dirname(documentPath);
  return pages.find((pagePath) => isPathInside(stateDirectory, path.dirname(pagePath)));
}

/** Segment-aware descendant check rejects ancestor and sibling routes. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Exact and extensionless authored paths avoid synchronous realpath work over whole inventories. */
interface AuthoredPathIndex {
  readonly exactPaths: ReadonlySet<string>;
  readonly pathsByIdentity: ReadonlyMap<string, readonly string[]>;
}

/** Indexes authored alternatives without collapsing legitimate `.ts`/`.tsx` sibling modules. */
function createAuthoredPathIndex(sourcePaths: readonly string[]): AuthoredPathIndex {
  const exactPaths = new Set<string>();
  const pathsByIdentity = new Map<string, string[]>();
  for (const candidate of sourcePaths) {
    const sourcePath = path.normalize(candidate);
    exactPaths.add(sourcePath);
    const identity = createModuleIdentity(sourcePath);
    const alternatives = pathsByIdentity.get(identity) ?? [];
    if (!alternatives.includes(sourcePath)) alternatives.push(sourcePath);
    pathsByIdentity.set(identity, alternatives);
  }
  return { exactPaths, pathsByIdentity };
}

/** Matches the resolver's exact file first and rejects ambiguous extensionless alternatives. */
function resolveAuthoredPath(index: AuthoredPathIndex, resolvedPath: string): string | undefined {
  const normalizedPath = path.normalize(resolvedPath);
  if (index.exactPaths.has(normalizedPath)) return normalizedPath;
  const alternatives = index.pathsByIdentity.get(createModuleIdentity(normalizedPath)) ?? [];
  if (alternatives.length === 1) return alternatives[0];
  const sameExtension = alternatives.filter(
    (candidate) =>
      path.extname(candidate).toLowerCase() === path.extname(normalizedPath).toLowerCase(),
  );
  return sameExtension.length === 1 ? sameExtension[0] : undefined;
}

/** Normalizes source extensions without importing or canonicalizing every workspace module. */
function createModuleIdentity(sourcePath: string): string {
  return path.normalize(sourcePath).replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '');
}

/** Reconstructs one selected path only after its final target edge has been proven. */
function reconstructModulePath(
  pending: readonly PendingModulePath[],
  leafIndex: number,
): readonly string[] {
  const reversed: string[] = [];
  let currentIndex: number | undefined = leafIndex;
  while (currentIndex !== undefined) {
    const current: PendingModulePath | undefined = pending[currentIndex];
    if (current === undefined) break;
    reversed.push(current.sourcePath);
    currentIndex = current.parentIndex;
  }
  return reversed.reverse();
}

/** Keeps the closest route page first without treating path similarity as import evidence. */
function comparePageAffinity(targetPath: string, left: string, right: string): number {
  return (
    scorePageAffinity(targetPath, right) - scorePageAffinity(targetPath, left) ||
    left.localeCompare(right)
  );
}

/** Scores common directories and an enclosing page route for deterministic candidate priority. */
function scorePageAffinity(targetPath: string, pagePath: string): number {
  const targetDirectory = path.dirname(targetPath);
  const pageDirectory = path.dirname(pagePath);
  const relative = path.relative(pageDirectory, targetDirectory);
  const enclosesTarget =
    relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
  const targetParts = targetDirectory.split(path.sep);
  const pageParts = pageDirectory.split(path.sep);
  let commonDepth = 0;
  const maximumCommonDepth = Math.min(targetParts.length, pageParts.length);
  while (commonDepth < maximumCommonDepth && targetParts[commonDepth] === pageParts[commonDepth]) {
    commonDepth += 1;
  }
  const dynamicPenalty = path
    .relative(findNamedAncestor(pageDirectory, 'app') ?? pageDirectory, pageDirectory)
    .split(path.sep)
    .reduce((total, segment) => {
      if (segment.startsWith('[[...')) return total + 3_000;
      if (segment.startsWith('[...')) return total + 2_000;
      return segment.startsWith('[') ? total + 1_000 : total;
    }, 0);
  return (
    commonDepth * 100 +
    (enclosesTarget ? 10_000 - relative.split(path.sep).length : 0) -
    dynamicPenalty
  );
}

/** Finds a named path boundary without assuming the nearest same-named child is the app root. */
function findNamedAncestor(sourcePath: string, name: string): string | undefined {
  let current = path.normalize(sourcePath);
  while (path.dirname(current) !== current) {
    if (path.basename(current).toLowerCase() === name) return current;
    current = path.dirname(current);
  }
  return path.basename(current).toLowerCase() === name ? current : undefined;
}

/**
 * Collects only runtime-bearing static imports, re-exports, dynamic imports, and `require` calls.
 * Type-only edges must never claim that a page evaluates or participates in the selected module.
 */
function collectRuntimeModuleSpecifiers(
  sourcePath: string,
  sourceText: string,
  targetPath: string,
): readonly RuntimeModuleSpecifier[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const importLocalNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    for (const localName of collectRuntimeImportLocalNames(statement.importClause)) {
      importLocalNames.add(localName);
    }
  }
  const runtimeReferenceNames = collectRuntimeReferenceNames(sourceFile, importLocalNames);
  const sourceDeclaresRequire = hasRuntimeDeclarationNamed(sourceFile, 'require');
  const deferredSpecifiers: RuntimeModuleSpecifier[] = [];
  const staticSpecifiers: RuntimeModuleSpecifier[] = [];
  const seen = new Set<string>();
  const append = (deferred: boolean, value: string): void => {
    const clean = value.split(/[?#]/u, 1)[0];
    if (clean === undefined || clean.length === 0) return;
    const key = `${deferred ? 'deferred' : 'static'}:${clean}`;
    if (seen.has(key)) return;
    seen.add(key);
    const values = deferred ? deferredSpecifiers : staticSpecifiers;
    if (values.length < MAXIMUM_COLLECTED_IMPORTS_PER_MODULE) {
      values.push({ deferred, value: clean });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const onlyTypeSpecifiers =
        named !== undefined &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly);
      const runtimeLocalNames = collectRuntimeImportLocalNames(clause);
      const hasRuntimeUsage =
        clause === undefined ||
        runtimeLocalNames.some((localName) => runtimeReferenceNames.has(localName));
      if (
        clause?.phaseModifier !== ts.SyntaxKind.TypeKeyword &&
        !onlyTypeSpecifiers &&
        hasRuntimeUsage
      ) {
        append(false, node.moduleSpecifier.text);
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      const exportSpecifier = node.moduleSpecifier;
      if (exportSpecifier === undefined || !ts.isStringLiteralLike(exportSpecifier)) return;
      const clause = node.exportClause;
      const onlyTypeSpecifiers =
        clause !== undefined &&
        ts.isNamedExports(clause) &&
        clause.elements.length > 0 &&
        clause.elements.every((element) => element.isTypeOnly);
      if (!node.isTypeOnly && !onlyTypeSpecifiers) {
        append(false, exportSpecifier.text);
      }
      return;
    }
    const callArgument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      ts.isCallExpression(node) &&
      callArgument !== undefined &&
      ts.isStringLiteralLike(callArgument) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (!sourceDeclaresRequire &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      append(node.expression.kind === ts.SyntaxKind.ImportKeyword, callArgument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const compareAffinity = (left: RuntimeModuleSpecifier, right: RuntimeModuleSpecifier): number =>
    scoreModuleSpecifierAffinity(targetPath, right.value) -
    scoreModuleSpecifierAffinity(targetPath, left.value);
  return Object.freeze([
    ...staticSpecifiers.sort(compareAffinity).slice(0, MAXIMUM_IMPORTS_PER_MODULE),
    ...deferredSpecifiers.sort(compareAffinity).slice(0, MAXIMUM_IMPORTS_PER_MODULE),
  ]);
}

/** Moves a target-like basename ahead of thousands of unrelated generated registry branches. */
function scoreModuleSpecifierAffinity(targetPath: string, moduleSpecifier: string): number {
  const targetStem = path
    .basename(targetPath)
    .replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '')
    .toLowerCase();
  const specifierStem = path.basename(moduleSpecifier).toLowerCase();
  if (specifierStem === targetStem) return 2;
  return specifierStem.includes(targetStem) || targetStem.includes(specifierStem) ? 1 : 0;
}

/** Extracts value bindings from one non-type import clause for conservative usage proof. */
function collectRuntimeImportLocalNames(clause: ts.ImportClause | undefined): readonly string[] {
  if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
    return Object.freeze([]);
  }
  const names: string[] = clause.name === undefined ? [] : [clause.name.text];
  const bindings = clause.namedBindings;
  if (bindings === undefined) return Object.freeze(names);
  if (ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
  else {
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) names.push(element.name.text);
    }
  }
  return Object.freeze(names);
}

/** Collects imported binding reads in one AST pass while excluding property/type/declaration names. */
function collectRuntimeReferenceNames(
  sourceFile: ts.SourceFile,
  importedNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const declaredNamesByScope = collectDeclaredNamesByScope(sourceFile);
  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
    if (
      ts.isIdentifier(node) &&
      importedNames.has(node.text) &&
      isRuntimeValueReference(node) &&
      !isShadowedReference(node, node.text, declaredNamesByScope, sourceFile)
    ) {
      used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return used;
}

/** Indexes local declarations by their lexical function/block scope for imported-name shadowing. */
function collectDeclaredNamesByScope(sourceFile: ts.SourceFile): ReadonlyMap<ts.Node, Set<string>> {
  const namesByScope = new Map<ts.Node, Set<string>>();
  const appendBinding = (scope: ts.Node, binding: ts.BindingName): void => {
    const names = namesByScope.get(scope) ?? new Set<string>();
    collectBindingNames(binding, names);
    namesByScope.set(scope, names);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isVariableDeclaration(node)) {
      appendBinding(findLexicalScope(node, sourceFile), node.name);
    } else if (ts.isParameter(node)) {
      appendBinding(findFunctionScope(node, sourceFile), node.name);
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name !== undefined
    ) {
      appendBinding(findParentLexicalScope(node, sourceFile), node.name);
    } else if (ts.isFunctionExpression(node) && node.name !== undefined) {
      appendBinding(node, node.name);
    } else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      appendBinding(node.block, node.variableDeclaration.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return namesByScope;
}

/** Recursively extracts identifiers from array/object binding patterns without evaluating them. */
function collectBindingNames(binding: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(binding)) {
    names.add(binding.text);
    return;
  }
  for (const element of binding.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, names);
  }
}

/** Finds the nearest function, block, or source scope owning a declaration. */
function findLexicalScope(node: ts.Node, sourceFile: ts.SourceFile): ts.Node {
  let current = node.parent;
  while (current !== sourceFile) {
    if (ts.isFunctionLike(current) || ts.isBlock(current)) return current;
    current = current.parent;
  }
  return sourceFile;
}

/** Parameters belong to their containing function even when its body introduces another block. */
function findFunctionScope(node: ts.Node, sourceFile: ts.SourceFile): ts.Node {
  let current = node.parent;
  while (current !== sourceFile) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return sourceFile;
}

/** Function/class declaration names live in the surrounding scope rather than their own body. */
function findParentLexicalScope(node: ts.Node, sourceFile: ts.SourceFile): ts.Node {
  let current = node.parent;
  while (current !== sourceFile) {
    if (ts.isFunctionLike(current) || ts.isBlock(current)) return current;
    current = current.parent;
  }
  return sourceFile;
}

/** Reports whether a nested declaration hides an imported binding at one reference location. */
function isShadowedReference(
  node: ts.Identifier,
  name: string,
  namesByScope: ReadonlyMap<ts.Node, ReadonlySet<string>>,
  sourceFile: ts.SourceFile,
): boolean {
  let current = node.parent;
  while (current !== sourceFile) {
    if (
      (ts.isFunctionLike(current) || ts.isBlock(current)) &&
      namesByScope.get(current)?.has(name) === true
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** Rejects declaration/property/type identifiers that do not read a runtime binding. */
function isRuntimeValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    ((ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isParameter(parent)) &&
      parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) &&
      parent.name === node &&
      !ts.isComputedPropertyName(parent.name)) ||
    (ts.isJsxAttribute(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    ts.isTypeNode(parent) ||
    ts.isJsxClosingElement(parent)
  ) {
    return false;
  }
  let current: ts.Node = node.parent;
  while (!ts.isSourceFile(current) && !ts.isStatement(current) && !ts.isExpression(current)) {
    if (ts.isTypeNode(current) || ts.isTypeParameterDeclaration(current)) return false;
    current = current.parent;
  }
  return true;
}

/** Conservatively disables CommonJS edges when authored code declares its own `require`. */
function hasRuntimeDeclarationNamed(sourceFile: ts.SourceFile, name: string): boolean {
  return [...collectDeclaredNamesByScope(sourceFile).values()].some((names) => names.has(name));
}
