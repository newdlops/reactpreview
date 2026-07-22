/**
 * Adapts an export-less, imperative ReactDOM entry into an importable Page Inspector root.
 * The analyzer reuses import-proven entry evidence and never evaluates application code. Runtime
 * preparation suppresses only the proven mount call, then exposes its authored JSX as a synthetic
 * default component so the preview owns the sole browser root.
 */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewBuildRequest } from '../../domain/preview';
import { createExistingPathIdentitySet, normalizeLexicalPath } from '../../shared/pathIdentity';
import {
  analyzePreviewRenderSource,
  createPreviewRenderSourceFile,
} from './renderGraph/previewRenderSourceAnalysis';
import {
  selectPreviewPrimaryTargetExport,
  selectPreviewTargetExports,
  type PreviewTargetExportSlot,
} from './previewTargetExports';

const SYNTHETIC_COMPONENT_BASENAME = 'ReactPreviewImperativeEntryRoot';

/** Source ranges needed to neutralize one mount and expose the same JSX through an export. */
export interface PreviewImperativeEntryTarget {
  /** Unique local component name appended only to the preview copy of the source module. */
  readonly componentName: string;
  /** Public target identity consumed by existing target and Inspector facade plugins. */
  readonly exportName: 'default';
  /** Complete import-proven ReactDOM mount call range in the authored source. */
  readonly mountCall: PreviewImperativeEntrySourceRange;
  /** Optional assigned `createRoot(...)` initializer that must not reserve the preview container. */
  readonly rootInitializer?: PreviewImperativeEntrySourceRange;
  /** Exact authored JSX expression mounted by ReactDOM. */
  readonly renderedJsx: string;
  /** Normalized absolute source identity associated with all ranges. */
  readonly sourcePath: string;
}

/** Half-open source range retained without TypeScript AST nodes. */
interface PreviewImperativeEntrySourceRange {
  readonly end: number;
  readonly start: number;
}

/** Parsed call plus its top-level statement, used only during one synchronous source inspection. */
interface TopLevelMountCall {
  readonly call: ts.CallExpression;
  readonly sourceFile: ts.SourceFile;
}

/** Compiler-facing target selection that keeps imperative details behind one module boundary. */
export interface PreviewCompilerTargetSelection {
  /** Explicit facade exports after optional entry-root synthesis. */
  readonly explicitExportNames: readonly string[];
  /** Primary Inspector export; absent for non-Inspector modes or export-less unsupported files. */
  readonly inspectorExportName?: string;
  /** Whether Page Inspector selected an import-proven imperative entry fallback. */
  readonly isImperativeEntry: boolean;
  /** Current source preparation advanced through the incremental workspace source state. */
  readonly prepareSource: (sourcePath: string, sourceText: string) => string;
  /** Source used only for inert target, render-chain, and ancestor analysis. */
  readonly sourceText: string;
  /** Runtime exports consumed by target bridge/facade generation. */
  readonly targetExports: readonly PreviewTargetExportSlot[];
}

/**
 * Selects ordinary authored exports or one synthetic default entry root for Page Inspector.
 * This compiler adapter keeps the orchestrator agnostic to source ranges and guarantees that hot
 * rebuild preparation is an identity function for every module outside the selected entry.
 *
 * @param request Active preview target identity, source, and render mode.
 * @returns Complete target-selection inputs shared by discovery and source compilation.
 */
export function preparePreviewCompilerTarget(
  request: Pick<PreviewBuildRequest, 'documentPath' | 'renderMode' | 'sourceText'>,
): PreviewCompilerTargetSelection {
  const authoredExports = selectPreviewTargetExports(request.documentPath, request.sourceText);
  const imperativeTarget =
    request.renderMode === 'page-inspector' &&
    !authoredExports.some((slot) => slot.kind === 'explicit')
      ? selectPreviewImperativeEntryTarget(request.documentPath, request.sourceText)
      : undefined;
  const sourceText =
    imperativeTarget === undefined
      ? request.sourceText
      : createPreviewImperativeEntryAnalysisSource(request.sourceText, imperativeTarget);
  const targetExports =
    imperativeTarget === undefined
      ? authoredExports
      : selectPreviewTargetExports(request.documentPath, sourceText);
  const inspectorExportName =
    request.renderMode === 'page-inspector'
      ? selectPreviewPrimaryTargetExport(targetExports)
      : undefined;
  const documentPathIdentities = createExistingPathIdentitySet([request.documentPath]);
  return Object.freeze({
    explicitExportNames: Object.freeze(
      targetExports.flatMap((slot) => (slot.kind === 'explicit' ? [slot.exportName] : [])),
    ),
    ...(inspectorExportName === undefined ? {} : { inspectorExportName }),
    isImperativeEntry: imperativeTarget !== undefined,
    prepareSource: (sourcePath: string, currentSourceText: string): string =>
      imperativeTarget !== undefined && documentPathIdentities.has(normalizeLexicalPath(sourcePath))
        ? preparePreviewImperativeEntryRuntimeSource(sourcePath, currentSourceText)
        : currentSourceText,
    sourceText,
    targetExports: Object.freeze(targetExports),
  });
}

/**
 * Selects the first top-level JSX mount from an entry module that has no existing default export.
 * Top-level scope is required because an appended component cannot safely capture function-local
 * bootstrap values. The caller additionally limits this fallback to files with no selected React
 * exports, preserving authored component/gallery behavior whenever it exists.
 *
 * @param sourcePath Absolute entry module path.
 * @param sourceText Current editor or disk source.
 * @returns Immutable pseudo-target evidence, or `undefined` when synthesis cannot be proven safe.
 */
export function selectPreviewImperativeEntryTarget(
  sourcePath: string,
  sourceText: string,
): PreviewImperativeEntryTarget | undefined {
  const normalizedPath = path.normalize(sourcePath);
  const analysis = analyzePreviewRenderSource(normalizedPath, sourceText);
  if (analysis.moduleFacts.exports.some((fact) => fact.exportName === 'default')) {
    return undefined;
  }
  const sourceFile = createPreviewRenderSourceFile(normalizedPath, sourceText);
  const occupiedNames = new Set([
    ...analysis.moduleFacts.imports.map((fact) => fact.localName),
    ...analysis.moduleFacts.values.map((fact) => fact.localName),
  ]);

  for (const evidence of analysis.entryEvidence) {
    const mount = findTopLevelMountCall(sourceFile, evidence.occurrenceStart);
    if (mount === undefined) continue;
    const jsx = selectMountedJsxArgument(mount.call);
    if (jsx === undefined) continue;
    const rootInitializer = selectAssignedRootInitializer(mount.call, sourceFile);
    return Object.freeze({
      componentName: selectUniqueComponentName(occupiedNames),
      exportName: 'default',
      mountCall: freezeRange(mount.call, sourceFile),
      ...(rootInitializer === undefined
        ? {}
        : { rootInitializer: freezeRange(rootInitializer, sourceFile) }),
      renderedJsx: jsx.getText(sourceFile),
      sourcePath: normalizedPath,
    });
  }
  return undefined;
}

/**
 * Appends the synthetic default component while retaining entry evidence for static graph search.
 * This source is analysis-only: the original mount remains visible to the render-chain planner but
 * is removed separately before esbuild evaluates the module in the webview.
 *
 * @param sourceText Authored entry source.
 * @param target Previously selected pseudo-target whose ranges belong to `sourceText`.
 * @returns Parseable source with one importable default React component.
 */
export function createPreviewImperativeEntryAnalysisSource(
  sourceText: string,
  target: PreviewImperativeEntryTarget,
): string {
  return appendSyntheticComponent(sourceText, target);
}

/**
 * Creates the browser-bound source copy for an imperative entry without mutating the workspace.
 * Assigned root creation is replaced before the mount call so an authored `#root` or `body`
 * container cannot be reserved ahead of React Preview's own root.
 *
 * @param sourcePath Module being loaded by the workspace source adapter.
 * @param sourceText Current source text, which may have advanced during hot reload.
 * @returns Original source when evidence disappeared, otherwise a safe synthetic-root module.
 */
export function preparePreviewImperativeEntryRuntimeSource(
  sourcePath: string,
  sourceText: string,
): string {
  const target = selectPreviewImperativeEntryTarget(sourcePath, sourceText);
  if (target === undefined) return sourceText;
  const replacements = [
    { range: target.mountCall, text: 'void 0' },
    ...(target.rootInitializer === undefined
      ? []
      : [{ range: target.rootInitializer, text: '({ render: () => undefined })' }]),
  ].sort((left, right) => right.range.start - left.range.start);
  let runtimeSource = sourceText;
  for (const replacement of replacements) {
    runtimeSource =
      runtimeSource.slice(0, replacement.range.start) +
      replacement.text +
      runtimeSource.slice(replacement.range.end);
  }
  return appendSyntheticComponent(runtimeSource, target);
}

/** Finds the evidence call and rejects mounts nested in functions, blocks, or conditionals. */
function findTopLevelMountCall(
  sourceFile: ts.SourceFile,
  occurrenceStart: number,
): TopLevelMountCall | undefined {
  let selected: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      selected !== undefined ||
      node.getStart(sourceFile) > occurrenceStart ||
      node.end < occurrenceStart
    ) {
      return;
    }
    if (ts.isCallExpression(node) && node.getStart(sourceFile) === occurrenceStart) {
      selected = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (selected === undefined || !belongsToTopLevelStatement(selected, sourceFile)) return undefined;
  return { call: selected, sourceFile };
}

/** Reports whether a call is contained directly by one source-file statement. */
function belongsToTopLevelStatement(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node = node;
  while (!ts.isExpressionStatement(current)) {
    const parent = current.parent;
    if (ts.isExpressionStatement(parent)) {
      current = parent;
      continue;
    }
    if (!isTransparentTopLevelExpression(parent)) return false;
    current = parent;
  }
  return current.parent === sourceFile;
}

/** Allows punctuation/type wrappers but never crosses a function, callback, block, or branch. */
function isTransparentTopLevelExpression(node: ts.Node): node is ts.Expression {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isVoidExpression(node)
  );
}

/** Finds the JSX argument already authorized by entry evidence through transparent wrappers. */
function selectMountedJsxArgument(
  call: ts.CallExpression,
): ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement | undefined {
  for (const argument of call.arguments) {
    const expression = unwrapExpression(argument);
    if (
      ts.isJsxElement(expression) ||
      ts.isJsxFragment(expression) ||
      ts.isJsxSelfClosingElement(expression)
    ) {
      return expression;
    }
  }
  return undefined;
}

/** Locates a top-level `const root = createRoot(...)` receiver proven by the entry analyzer. */
function selectAssignedRootInitializer(
  mountCall: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  const callee = unwrapExpression(mountCall.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'render') return undefined;
  const receiver = unwrapExpression(callee.expression);
  if (!ts.isIdentifier(receiver)) return undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === receiver.text &&
        declaration.initializer !== undefined &&
        declaration.getStart(sourceFile) < mountCall.getStart(sourceFile)
      ) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

/** Unwraps syntax that preserves the runtime identity of a call receiver or JSX argument. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Picks a deterministic PascalCase binding without shadowing authored imports or declarations. */
function selectUniqueComponentName(occupiedNames: ReadonlySet<string>): string {
  for (let suffix = 0; suffix <= occupiedNames.size; suffix += 1) {
    const candidate =
      suffix === 0
        ? SYNTHETIC_COMPONENT_BASENAME
        : `${SYNTHETIC_COMPONENT_BASENAME}${suffix.toString()}`;
    if (!occupiedNames.has(candidate)) return candidate;
  }
  throw new Error('React Preview could not allocate an imperative entry component name.');
}

/** Copies one AST range into a JSON-safe immutable value. */
function freezeRange(node: ts.Node, sourceFile: ts.SourceFile): PreviewImperativeEntrySourceRange {
  return Object.freeze({ end: node.end, start: node.getStart(sourceFile) });
}

/** Adds the importable root at EOF so it can close over every top-level entry binding. */
function appendSyntheticComponent(
  sourceText: string,
  target: PreviewImperativeEntryTarget,
): string {
  return `${sourceText}\nfunction ${target.componentName}() {\n  return (${target.renderedJsx});\n}\nexport default ${target.componentName};\n`;
}
