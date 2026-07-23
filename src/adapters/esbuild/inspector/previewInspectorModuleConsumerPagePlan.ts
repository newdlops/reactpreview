/**
 * Recovers an authored page for editor-selected modules that expose hooks or JSX factories.
 *
 * A hook module normally has no React element type that Page Inspector can mount. Its exported
 * function can still participate in rendering when a component imports and calls it, for example
 * `const { renderModal } = useModal(); return renderModal()`. This planner seeds the existing
 * syntax-only render graph with those callable exports, promotes the first statically exported
 * component on the proven call path, and delegates ordinary page ancestry to the shared planner.
 * No project function is invoked in the extension host.
 */
import path from 'node:path';
import ts from 'typescript';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import {
  createPreviewRenderChainPlans,
  type PreviewRenderChainCandidate,
  type PreviewRenderChainPlan,
  type PreviewRenderChainPlansByExport,
  type PreviewRenderChainStep,
  type ResolvePreviewRenderGraphModule,
} from '../renderGraph';
import { createPreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type {
  PreviewInspectorAncestorPlan,
  PreviewInspectorComponentReference,
  ReadPreviewInspectorAcceptedSpecifiers,
  ReadPreviewInspectorSource,
} from './previewInspectorAncestorTypes';

const MAXIMUM_CALLABLE_EXPORTS = 12;
const MAXIMUM_CONVENTIONAL_SOURCE_PATHS = 1_024;
const MAXIMUM_SOURCE_PATHS = 4_096;
const MAXIMUM_TOTAL_SOURCE_BYTES = 32 * 1024 * 1024;

/** Public limits make performance regressions testable without exposing planner internals. */
export const PREVIEW_INSPECTOR_MODULE_CONSUMER_LIMITS = Object.freeze({
  maximumCallableExports: MAXIMUM_CALLABLE_EXPORTS,
  maximumConventionalSourcePaths: MAXIMUM_CONVENTIONAL_SOURCE_PATHS,
  maximumSourcePaths: MAXIMUM_SOURCE_PATHS,
  maximumTotalSourceBytes: MAXIMUM_TOTAL_SOURCE_BYTES,
});

/** Inputs shared with the ordinary ancestor planner after a callable consumer is discovered. */
export interface CreatePreviewInspectorModuleConsumerPagePlanOptions {
  /** Optional exact import aliases used when the promoted component climbs toward its page. */
  readonly acceptedImportSpecifiers?: ReadPreviewInspectorAcceptedSpecifiers;
  /** Absolute hook/factory module selected by the editor command. */
  readonly documentPath: string;
  /** Current snapshot-aware source reader bounded by the compiler's trusted workspace. */
  readonly readSource: ReadPreviewInspectorSource;
  /** Alias-aware module resolver shared with the eventual esbuild invocation. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Cancels stale graph work before another preview request can inherit its result. */
  readonly signal?: AbortSignal;
  /** Existing nearest-package source inventory; this function never walks the filesystem. */
  readonly sourcePaths: readonly string[];
}

/** One callable target path and the first importable React owner reached from it. */
interface ConsumerSeed {
  readonly callableExportName: string;
  readonly component: PreviewInspectorComponentReference;
  readonly componentStepIndex: number;
  readonly path: PreviewRenderChainCandidate;
  readonly plan: PreviewRenderChainPlan;
  readonly score: number;
}

/** Runtime export metadata retained without carrying TypeScript AST nodes between source reads. */
interface CallableExportInventory {
  readonly exportNames: readonly string[];
}

/** Public component aliases offered by one top-level declaration. */
interface ExportedComponentValue {
  readonly exportNames: readonly string[];
  readonly localName: string;
}

/**
 * Reports whether the selected source itself exports a hook or JSX-producing factory.
 *
 * The compiler calls this local-only probe before requesting a package source inventory. That
 * keeps ordinary components, empty modules, and data-only files on the direct first-paint path,
 * while default-exported factories and mixed `CONFIG + useFeature` modules can still recover the
 * authored page that invokes them.
 */
export function hasPreviewInspectorCallableModuleExports(
  sourcePath: string,
  sourceText: string,
): boolean {
  return collectCallableRuntimeExports(sourcePath, sourceText).exportNames.length > 0;
}

/**
 * Finds a component/page that calls one selected module export and returns a context-only plan.
 *
 * The selected module remains `contextModule` because a hook or factory has no stable host DOM
 * boundary. The promoted component becomes the instrumentation target, so Page Inspector can still
 * validate the real page corridor, route, providers, and layout around the selected source.
 */
export async function createPreviewInspectorModuleConsumerPagePlan(
  options: CreatePreviewInspectorModuleConsumerPagePlanOptions,
): Promise<PreviewInspectorAncestorPlan | undefined> {
  throwIfPreviewBuildCancelled(options.signal);
  if (!path.isAbsolute(options.documentPath)) {
    throw new RangeError('Preview module-consumer target path must be absolute.');
  }

  const documentPath = path.normalize(options.documentPath);
  const inventoryPaths = [
    ...new Set(
      [...options.sourcePaths, documentPath].map((sourcePath) => path.normalize(sourcePath)),
    ),
  ].sort();
  const sourcePaths = selectBoundedConsumerSourcePaths(inventoryPaths, documentPath);
  const sourceByPath = createBoundedSourceReader(options.readSource);
  const targetSource = await sourceByPath(documentPath);
  if (targetSource === undefined) return undefined;

  const callableExports = collectCallableRuntimeExports(documentPath, targetSource).exportNames;
  if (callableExports.length === 0) return undefined;
  throwIfPreviewBuildCancelled(options.signal);

  const plans = await createPreviewRenderChainPlans({
    documentPath,
    exportNames: callableExports.slice(0, MAXIMUM_CALLABLE_EXPORTS),
    readSource: sourceByPath,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourcePaths,
  });
  const seed = await selectBestConsumerSeed(plans, sourceByPath, documentPath, options.signal);
  if (seed === undefined) return undefined;

  const componentRenderPlan = createComponentRenderPlan(seed);
  const componentPlan = await createPreviewInspectorAncestorPlan({
    ...(options.acceptedImportSpecifiers === undefined
      ? {}
      : { acceptedImportSpecifiers: options.acceptedImportSpecifiers }),
    documentPath: seed.component.sourcePath,
    exportName: seed.component.exportName,
    readSource: sourceByPath,
    renderChainsByExport: Object.freeze({
      [seed.component.exportName]: componentRenderPlan,
    }),
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourcePaths,
  });
  throwIfPreviewBuildCancelled(options.signal);

  const importPath = createPageToModuleImportPath(componentPlan, seed, documentPath);
  const dependencyPaths = Object.freeze(
    [...new Set([...componentPlan.dependencyPaths, ...seed.plan.dependencyPaths, ...importPath])]
      .map((sourcePath) => path.normalize(sourcePath))
      .sort(),
  );
  return Object.freeze({
    ...componentPlan,
    contextModule: Object.freeze({
      evidenceKind: 'import-chain' as const,
      importPath,
      sourcePath: documentPath,
    }),
    dependencyPaths,
  });
}

/**
 * Keeps the target's nearest feature files plus conventional page/entry files under one hard cap.
 * The later exact reverse-import graph still decides correctness; this ranking only prevents an
 * optional hook-context pass from reparsing an entire generated monorepo inventory.
 */
function selectBoundedConsumerSourcePaths(
  sourcePaths: readonly string[],
  documentPath: string,
): readonly string[] {
  if (sourcePaths.length <= MAXIMUM_SOURCE_PATHS) return sourcePaths;
  const targetSegments = path.dirname(documentPath).split(path.sep).filter(Boolean);
  const ranked = sourcePaths.map((sourcePath) => ({
    score: scoreConsumerSourcePath(sourcePath, documentPath, targetSegments),
    sourcePath,
  }));
  const compare = (left: (typeof ranked)[number], right: (typeof ranked)[number]): number => {
    const scoreDifference = right.score - left.score;
    return scoreDifference !== 0
      ? scoreDifference
      : left.sourcePath.localeCompare(right.sourcePath);
  };
  ranked.sort(compare);
  const selected = new Set<string>([documentPath]);
  for (const item of ranked.filter((candidate) =>
    isConventionalPageOrEntry(candidate.sourcePath),
  )) {
    if (selected.size >= MAXIMUM_CONVENTIONAL_SOURCE_PATHS) break;
    selected.add(item.sourcePath);
  }
  for (const item of ranked) {
    if (selected.size >= MAXIMUM_SOURCE_PATHS) break;
    selected.add(item.sourcePath);
  }
  return Object.freeze([...selected].sort());
}

/** Assigns path-only affinity before any source text is read or TypeScript AST is allocated. */
function scoreConsumerSourcePath(
  sourcePath: string,
  documentPath: string,
  targetDirectorySegments: readonly string[],
): number {
  if (sourcePath === documentPath) return Number.MAX_SAFE_INTEGER;
  const sourceSegments = path.dirname(sourcePath).split(path.sep).filter(Boolean);
  let commonSegments = 0;
  while (
    commonSegments < targetDirectorySegments.length &&
    targetDirectorySegments[commonSegments] === sourceSegments[commonSegments]
  ) {
    commonSegments += 1;
  }
  const fileName = path.basename(sourcePath).toLowerCase();
  const distance = targetDirectorySegments.length + sourceSegments.length - commonSegments * 2;
  return (
    commonSegments * 100 -
    Math.min(distance, 100) +
    (/^index\.[cm]?[jt]sx?$/u.test(fileName) ? 50 : 0)
  );
}

/** Recognizes framework-neutral filenames likely to connect a feature component to ReactDOM. */
function isConventionalPageOrEntry(sourcePath: string): boolean {
  const fileName = path.basename(sourcePath).toLowerCase();
  return /(?:^|[-_.])(?:app|bootstrap|entry|layout|main|page|route|router|screen|view)(?:[-_.]|$)/u.test(
    fileName,
  );
}

/** Creates one memoized reader with a strict aggregate byte ceiling for this optional analysis. */
function createBoundedSourceReader(
  readSource: ReadPreviewInspectorSource,
): ReadPreviewInspectorSource {
  const sourceByPath = new Map<string, Promise<string | undefined>>();
  let admittedBytes = 0;
  return (sourcePath) => {
    const normalizedPath = path.normalize(sourcePath);
    const cached = sourceByPath.get(normalizedPath);
    if (cached !== undefined) return cached;
    const pending = readSource(normalizedPath).then((sourceText) => {
      if (sourceText === undefined) return undefined;
      const byteLength = Buffer.byteLength(sourceText, 'utf8');
      if (admittedBytes + byteLength > MAXIMUM_TOTAL_SOURCE_BYTES) return undefined;
      admittedBytes += byteLength;
      return sourceText;
    });
    sourceByPath.set(normalizedPath, pending);
    return pending;
  };
}

/**
 * Selects callable runtime exports, including named aliases and named re-exports.
 * Function/class values are included only when their name or body provides hook/render-factory
 * evidence; ordinary PascalCase components remain on the normal Page Inspector path.
 */
function collectCallableRuntimeExports(
  sourcePath: string,
  sourceText: string,
): CallableExportInventory {
  const sourceFile = createSourceFile(sourcePath, sourceText);
  const callableLocalNames = new Set<string>();
  const exportedNames: string[] = [];
  const seen = new Set<string>();

  /** Adds one explicit non-wildcard runtime name while retaining authored order. */
  const add = (exportName: string): void => {
    if (exportName === '*' || seen.has(exportName)) return;
    seen.add(exportName);
    exportedNames.push(exportName);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      if (isHookOrRenderFactory(statement.name.text, statement)) {
        callableLocalNames.add(statement.name.text);
        if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
          add(
            hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? 'default' : statement.name.text,
          );
        }
      }
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.initializer === undefined ||
        !isCallableExpression(declaration.initializer) ||
        !isHookOrRenderFactory(declaration.name.text, declaration.initializer)
      ) {
        continue;
      }
      callableLocalNames.add(declaration.name.text);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) add(declaration.name.text);
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (
        isHookOrRenderFactoryExpression(statement.expression, callableLocalNames) ||
        (ts.isIdentifier(statement.expression) && callableLocalNames.has(statement.expression.text))
      ) {
        add('default');
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement) || statement.exportClause === undefined) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly) continue;
      const localName = (element.propertyName ?? element.name).text;
      if (statement.moduleSpecifier !== undefined || callableLocalNames.has(localName)) {
        if (isCallableExportName(element.name.text) || isCallableExportName(localName)) {
          add(element.name.text);
        }
      }
    }
  }
  return Object.freeze({ exportNames: Object.freeze(exportedNames) });
}

/**
 * Requires hook/factory spelling, a returned JSX callback, or JSX owned by a lower-camel helper.
 * PascalCase/default components that directly return JSX stay on the ordinary component path.
 */
function isHookOrRenderFactory(name: string, node: ts.Node): boolean {
  return (
    isCallableExportName(name) ||
    containsReturnedRenderCallback(node) ||
    (isLowerCamelRuntimeName(name) && containsJsx(node))
  );
}

/** Recognizes stable hook and render-factory names without project-specific allowlists. */
function isCallableExportName(name: string): boolean {
  return /^(?:use[A-Z0-9_]|(?:create|make|build|render)[A-Z0-9_])/u.test(name);
}

/** Distinguishes callable helpers from PascalCase component declarations and the default slot. */
function isLowerCamelRuntimeName(name: string): boolean {
  return /^[a-z][A-Za-z0-9_$]*$/u.test(name) && name !== 'default';
}

/** Resolves only local identifier aliases and direct callable expressions for a default export. */
function isHookOrRenderFactoryExpression(
  expression: ts.Expression,
  callableLocalNames: ReadonlySet<string>,
): boolean {
  const current = unwrapExpression(expression);
  return (
    (ts.isIdentifier(current) && callableLocalNames.has(current.text)) ||
    (isCallableExpression(current) && isHookOrRenderFactory('default', current))
  );
}

/** Accepts direct function values after removing erased TypeScript expression wrappers. */
function isCallableExpression(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  return ts.isArrowFunction(current) || ts.isFunctionExpression(current);
}

/** Detects JSX nested in a hook's returned renderer without interpreting the callback. */
function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** Recognizes returned object/function values that expose a JSX-producing callback contract. */
function containsReturnedRenderCallback(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (
      (ts.isArrowFunction(child) || ts.isFunctionExpression(child)) &&
      child !== node &&
      containsJsx(child)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** Finds the strongest entry/page-connected component reached from any selected callable export. */
async function selectBestConsumerSeed(
  plans: PreviewRenderChainPlansByExport,
  readSource: ReadPreviewInspectorSource,
  documentPath: string,
  signal: AbortSignal | undefined,
): Promise<ConsumerSeed | undefined> {
  const sourceInventoryByPath = new Map<string, Promise<readonly ExportedComponentValue[]>>();
  const seeds: ConsumerSeed[] = [];
  for (const [callableExportName, plan] of Object.entries(plans)) {
    for (const candidate of plan.paths) {
      throwIfPreviewBuildCancelled(signal);
      for (let index = 1; index < candidate.steps.length; index += 1) {
        const step = candidate.steps[index];
        if (step === undefined || path.normalize(step.sourcePath) === documentPath) continue;
        const component = await readExportedComponentForStep(
          step,
          readSource,
          sourceInventoryByPath,
        );
        if (component === undefined) continue;
        seeds.push({
          callableExportName,
          component,
          componentStepIndex: index,
          path: candidate,
          plan,
          score: scoreConsumerSeed(plan, candidate, component, index),
        });
        break;
      }
    }
  }
  seeds.sort(compareConsumerSeeds);
  return seeds[0];
}

/** Maps one render-graph declaration label back to a public component export in that module. */
async function readExportedComponentForStep(
  step: PreviewRenderChainStep,
  readSource: ReadPreviewInspectorSource,
  cache: Map<string, Promise<readonly ExportedComponentValue[]>>,
): Promise<PreviewInspectorComponentReference | undefined> {
  const sourcePath = path.normalize(step.sourcePath);
  let pending = cache.get(sourcePath);
  if (pending === undefined) {
    pending = readSource(sourcePath).then((sourceText) =>
      sourceText === undefined
        ? Object.freeze([])
        : collectExportedComponentValues(sourcePath, sourceText),
    );
    cache.set(sourcePath, pending);
  }
  const values = await pending;
  const label = normalizeRenderStepLabel(step.label);
  const selected = values.find((value) => value.localName === label);
  const exportName = selected?.exportNames.includes('default')
    ? 'default'
    : selected?.exportNames[0];
  return exportName === undefined ? undefined : Object.freeze({ exportName, sourcePath });
}

/** Collects importable component values while rejecting route objects and lower-camel helpers. */
function collectExportedComponentValues(
  sourcePath: string,
  sourceText: string,
): readonly ExportedComponentValue[] {
  const sourceFile = createSourceFile(sourcePath, sourceText);
  const componentLocals = new Set<string>();
  const exportsByLocal = new Map<string, string[]>();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      const localName = statement.name?.text ?? '@default';
      if (isComponentDeclaration(localName, statement)) componentLocals.add(localName);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        appendExport(
          exportsByLocal,
          localName,
          hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? 'default' : localName,
        );
      }
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const localName = declaration.name.text;
      if (isComponentDeclaration(localName, declaration.initializer ?? declaration)) {
        componentLocals.add(localName);
        if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
          appendExport(exportsByLocal, localName, localName);
        }
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const current = unwrapExpression(statement.expression);
      if (ts.isIdentifier(current) && componentLocals.has(current.text)) {
        appendExport(exportsByLocal, current.text, 'default');
      } else if (isComponentDeclaration('@default', current)) {
        componentLocals.add('@default');
        appendExport(exportsByLocal, '@default', 'default');
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined) continue;
    if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause))
      continue;
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly) continue;
      const localName = (element.propertyName ?? element.name).text;
      if (componentLocals.has(localName))
        appendExport(exportsByLocal, localName, element.name.text);
    }
  }
  return Object.freeze(
    [...componentLocals].flatMap((localName) => {
      const exportNames = exportsByLocal.get(localName);
      return exportNames === undefined || exportNames.length === 0
        ? []
        : [{ exportNames: Object.freeze([...new Set(exportNames)]), localName }];
    }),
  );
}

/** PascalCase values are component candidates only when their syntax can own a runtime value. */
function isComponentDeclaration(localName: string, node: ts.Node): boolean {
  if (localName !== '@default' && !/^[$A-Z_]/u.test(localName)) return false;
  const expression = ts.isExpression(node) ? unwrapExpression(node) : undefined;
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    (expression !== undefined && ts.isCallExpression(expression)) ||
    containsJsx(node)
  );
}

/** Appends an export alias without allowing duplicate public spellings. */
function appendExport(index: Map<string, string[]>, localName: string, exportName: string): void {
  const names = index.get(localName);
  if (names === undefined) index.set(localName, [exportName]);
  else if (!names.includes(exportName)) names.push(exportName);
}

/** Removes the planner's explanatory default suffix before matching a source declaration. */
function normalizeRenderStepLabel(label: string): string {
  const normalized = label.replace(/ \(default\)$/u, '');
  return normalized === 'default' ? '@default' : normalized;
}

/** Entry reachability, page naming, and shorter call distance determine one stable seed. */
function scoreConsumerSeed(
  plan: PreviewRenderChainPlan,
  candidate: PreviewRenderChainCandidate,
  component: PreviewInspectorComponentReference,
  componentStepIndex: number,
): number {
  const normalizedPath = component.sourcePath.replaceAll('\\', '/').toLowerCase();
  const exportName = component.exportName.toLowerCase();
  return (
    (candidate.entryPoint === undefined ? 0 : 20_000) +
    (plan.reachability === 'entry-connected' ? 2_000 : 0) +
    (/(?:^|\/)(?:pages?|routes?|screens?|views?|layouts?)(?:\/|$)/u.test(normalizedPath)
      ? 500
      : 0) +
    (/(?:page|route|screen|view|layout)$/u.test(exportName) ? 300 : 0) -
    componentStepIndex * 4
  );
}

/** Uses source identity as a deterministic tie-break after semantic path scoring. */
function compareConsumerSeeds(left: ConsumerSeed, right: ConsumerSeed): number {
  const scoreDifference = right.score - left.score;
  if (scoreDifference !== 0) return scoreDifference;
  const pathDifference = left.component.sourcePath.localeCompare(right.component.sourcePath);
  return pathDifference !== 0
    ? pathDifference
    : left.component.exportName.localeCompare(right.component.exportName);
}

/** Re-bases the callable's proven path at the promoted component without rebuilding the graph. */
function createComponentRenderPlan(seed: ConsumerSeed): PreviewRenderChainPlan {
  const selectedStepLabel = normalizeRenderStepLabel(
    seed.path.steps[seed.componentStepIndex]?.label ?? '',
  );
  const paths = seed.plan.paths.flatMap((candidate) => {
    const stepIndex = candidate.steps.findIndex(
      (step, index) =>
        index > 0 &&
        path.normalize(step.sourcePath) === seed.component.sourcePath &&
        normalizeRenderStepLabel(step.label) === selectedStepLabel,
    );
    if (stepIndex < 0) return [];
    return [
      Object.freeze({
        ...candidate,
        id: `${candidate.id}:consumer:${seed.component.exportName}`,
        steps: preservePromotedCallableEvidence(candidate, stepIndex, seed.plan.target.sourcePath),
      }),
    ];
  });
  return Object.freeze({
    ...seed.plan,
    paths: Object.freeze(
      paths.length > 0
        ? paths
        : [
            Object.freeze({
              ...seed.path,
              id: `${seed.path.id}:consumer:${seed.component.exportName}`,
              steps: preservePromotedCallableEvidence(
                seed.path,
                seed.componentStepIndex,
                seed.plan.target.sourcePath,
              ),
            }),
          ],
    ),
    target: seed.component,
  });
}

/**
 * Carries the discarded hook/HOC segment into the promoted component's exact path evidence.
 *
 * A context module has no host boundary, so its render path is intentionally re-based at the first
 * consuming component. The removed steps can nevertheless contain wrapper definitions such as an
 * authentication HOC whose early return decides whether that component ever renders. Folding only
 * those compiler-proven source identities into the first retained step lets the browser's bounded
 * DFS recognize the guard without admitting arbitrary transitive dependencies or page siblings.
 */
function preservePromotedCallableEvidence(
  candidate: PreviewRenderChainCandidate,
  stepIndex: number,
  callableSourcePath: string,
): readonly PreviewRenderChainStep[] {
  const retained = candidate.steps.slice(stepIndex);
  const promoted = retained[0];
  if (promoted === undefined) return Object.freeze([]);
  const evidenceSourcePaths = new Set<string>([path.normalize(callableSourcePath)]);
  for (const step of candidate.steps.slice(0, stepIndex + 1)) {
    for (const sourcePath of step.evidenceSourcePaths ?? []) {
      evidenceSourcePaths.add(path.normalize(sourcePath));
    }
  }
  return Object.freeze([
    Object.freeze({
      ...promoted,
      evidenceSourcePaths: Object.freeze([...evidenceSourcePaths]),
    }),
    ...retained.slice(1),
  ]);
}

/** Orders the static corridor from the mounted page root toward the selected source module. */
function createPageToModuleImportPath(
  plan: PreviewInspectorAncestorPlan,
  seed: ConsumerSeed,
  documentPath: string,
): readonly string[] {
  const innerToOuter = seed.path.steps.map((step) => path.normalize(step.sourcePath));
  const rootIndex = innerToOuter.findIndex(
    (sourcePath) => sourcePath === path.normalize(plan.root.sourcePath),
  );
  const selected = rootIndex < 0 ? innerToOuter : innerToOuter.slice(0, rootIndex + 1);
  const pageToModule = [...selected].reverse();
  pageToModule.push(documentPath);
  const deduplicated: string[] = [];
  for (const sourcePath of pageToModule) {
    if (deduplicated.at(-1) !== sourcePath) deduplicated.push(sourcePath);
  }
  return Object.freeze(deduplicated);
}

/** Parses one TS/JS module using JSX grammar when its extension permits authored JSX. */
function createSourceFile(sourcePath: string, sourceText: string): ts.SourceFile {
  const lowerPath = sourcePath.toLowerCase();
  const scriptKind = lowerPath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : lowerPath.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : lowerPath.endsWith('.js') || lowerPath.endsWith('.mjs') || lowerPath.endsWith('.cjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  return ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}

/** Removes TypeScript-only expression wrappers without evaluating the underlying value. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Checks syntax modifiers through TypeScript's node-kind-safe public helper. */
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((item) => item.kind === kind) === true
  );
}
