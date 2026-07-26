/** Bounded syntax-only recovery of outer styled-components StyleSheetManager layers. */
/* eslint-disable jsdoc/require-description */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewRenderChainCandidate } from './renderGraph/previewRenderGraphTypes';
import type { PreviewStyledComponentsAvailability } from './previewStyledComponentsAvailability';
import {
  createPreviewStyledComponentsPlan,
  MAX_STYLE_SHEET_MANAGER_IMPORTED_BINDINGS,
  MAX_STYLE_SHEET_MANAGER_IGNORED_REASONS,
  MAX_STYLE_SHEET_MANAGER_LAYERS,
  MAX_STYLE_SHEET_MANAGER_MODULES,
  MAX_STYLE_SHEET_MANAGER_SOURCE_BYTES,
  type PreviewStyleSheetBindingReference,
  type PreviewStyleSheetManagerIgnoredReason,
  type PreviewStyleSheetManagerLayer,
  type PreviewStyledComponentsPlan,
} from './previewStyledComponentsPlan';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';

export interface PreviewMountedRootReference {
  readonly exportName: string;
  readonly rootStepIndex?: number;
  readonly sourcePath: string;
}

export interface SelectPreviewStyleSheetManagerOptions {
  readonly availability: PreviewStyledComponentsAvailability;
  readonly mountedRoot?: PreviewMountedRootReference;
  readonly readSource: (sourcePath: string, maximumBytes: number) => Promise<string | undefined>;
  readonly renderPath?: PreviewRenderChainCandidate;
  readonly resolveModule: PreviewStaticModuleResolver['resolve'];
}

/**
 * Scans only the proven outer page corridor. Ambiguity deliberately discards all authored layers,
 * because replaying half of a StyleSheetManager stack can alter style ordering or prop forwarding.
 */
export async function selectPreviewStyleSheetManagerPlan(
  options: SelectPreviewStyleSheetManagerOptions,
): Promise<PreviewStyledComponentsPlan> {
  if (!options.availability.available) return absent(options.availability.dependencyPaths);
  if (options.renderPath === undefined || options.mountedRoot === undefined) {
    return synthetic(options.availability.dependencyPaths, []);
  }
  const sourcePaths = selectOuterPaths(options.renderPath, options.mountedRoot);
  if (sourcePaths.length > MAX_STYLE_SHEET_MANAGER_MODULES) {
    return synthetic(options.availability.dependencyPaths, ['analysis-truncated']);
  }
  const reasons = new Set<PreviewStyleSheetManagerIgnoredReason>();
  const layers: PreviewStyleSheetManagerLayer[] = [];
  const dependencyPaths = new Set(options.availability.dependencyPaths);
  let bindingCount = 0;
  for (const sourcePath of sourcePaths) {
    const sourceText = await options.readSource(sourcePath, MAX_STYLE_SHEET_MANAGER_SOURCE_BYTES);
    if (sourceText === undefined) continue;
    dependencyPaths.add(path.normalize(sourcePath));
    const sourceFile = createSourceFile(sourcePath, sourceText);
    if (parseFailed(sourceFile)) return synthetic([...dependencyPaths], ['parse-error']);
    const found = collectManagerLayers(sourceFile, sourcePath, reasons);
    if (found.ambiguous) return synthetic([...dependencyPaths], boundedReasons(reasons));
    for (const layer of found.layers) {
      bindingCount += layerBindings(layer).length;
      if (bindingCount > MAX_STYLE_SHEET_MANAGER_IMPORTED_BINDINGS) {
        return synthetic([...dependencyPaths], reasonsWith(reasons, 'analysis-truncated'));
      }
      layers.push(layer);
    }
    if (layers.length > MAX_STYLE_SHEET_MANAGER_LAYERS) {
      return synthetic([...dependencyPaths], reasonsWith(reasons, 'analysis-truncated'));
    }
  }
  return layers.length === 0
    ? synthetic([...dependencyPaths], [...reasons])
    : createPreviewStyledComponentsPlan({
        available: true,
        dependencyPaths: [...dependencyPaths].sort(),
        evidence: 'authored',
        ignoredReasons: boundedReasons(reasons),
        layers,
        sharedRuntimeChunk: true,
      });
}

/**
 *
 */
function absent(dependencyPaths: readonly string[]): PreviewStyledComponentsPlan {
  return createPreviewStyledComponentsPlan({
    available: false,
    dependencyPaths: [...dependencyPaths].sort(),
    evidence: 'absent',
    ignoredReasons: [],
    layers: [],
    sharedRuntimeChunk: false,
  });
}

/**
 *
 */
function synthetic(
  dependencyPaths: readonly string[],
  reasons: readonly PreviewStyleSheetManagerIgnoredReason[],
): PreviewStyledComponentsPlan {
  return createPreviewStyledComponentsPlan({
    available: true,
    dependencyPaths: [...new Set(dependencyPaths)].sort(),
    evidence: 'synthetic',
    ignoredReasons: boundedReasons(reasons),
    layers: [{ sourceKind: 'synthetic' }],
    sharedRuntimeChunk: true,
  });
}

/**
 *
 */
function selectOuterPaths(
  renderPath: PreviewRenderChainCandidate,
  mountedRoot: PreviewMountedRootReference,
): readonly string[] {
  let index = mountedRoot.rootStepIndex;
  if (index === undefined || renderPath.steps[index]?.sourcePath !== mountedRoot.sourcePath) {
    index = renderPath.steps.findIndex((step) => step.sourcePath === mountedRoot.sourcePath);
  }
  if (index < 0) return [];
  return [
    ...new Set(renderPath.steps.slice(index + 1).map((step) => path.normalize(step.sourcePath))),
  ];
}

/**
 *
 */
function createSourceFile(sourcePath: string, text: string): ts.SourceFile {
  const extension = path.extname(sourcePath).toLowerCase();
  const scriptKind =
    extension === '.tsx'
      ? ts.ScriptKind.TSX
      : extension === '.jsx'
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.TSX;
  return ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true, scriptKind);
}

/**
 *
 */
function parseFailed(sourceFile: ts.SourceFile): boolean {
  return (
    ((sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics?.length ?? 0) > 0
  );
}

/**
 *
 */
function collectManagerLayers(
  sourceFile: ts.SourceFile,
  importerPath: string,
  reasons: Set<PreviewStyleSheetManagerIgnoredReason>,
): { readonly ambiguous: boolean; readonly layers: readonly PreviewStyleSheetManagerLayer[] } {
  const managerNames = new Set<string>();
  const namespaces = new Set<string>();
  const bindings = new Map<string, PreviewStyleSheetBindingReference>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'styled-components'
    ) {
      const clause = statement.importClause;
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        namespaces.add(clause.namedBindings.name.text);
      for (const element of clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements
        : []) {
        if ((element.propertyName?.text ?? element.name.text) === 'StyleSheetManager')
          managerNames.add(element.name.text);
      }
    }
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      collectImportedBindings(statement, importerPath, bindings);
    }
    if (ts.isVariableStatement(statement))
      collectRequireManager(statement, managerNames, namespaces);
  }
  const layers: PreviewStyleSheetManagerLayer[] = [];
  let ambiguous = false;
  const visit = (node: ts.Node): void => {
    const recognised =
      isManagerJsx(node, managerNames, namespaces) ??
      isManagerCreateElement(node, managerNames, namespaces);
    if (recognised !== undefined) {
      const parsed = parseManagerProps(recognised.props, bindings, reasons);
      if (parsed === undefined) ambiguous = true;
      else layers.push(parsed);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return { ambiguous, layers };
}

/**
 *
 */
function collectImportedBindings(
  statement: ts.ImportDeclaration,
  importerPath: string,
  bindings: Map<string, PreviewStyleSheetBindingReference>,
): void {
  const clause = statement.importClause;
  if (
    clause === undefined ||
    clause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
    !ts.isStringLiteralLike(statement.moduleSpecifier)
  )
    return;
  const moduleSpecifier = statement.moduleSpecifier.text;
  if (clause.name)
    bindings.set(clause.name.text, {
      access: { kind: 'default' },
      importerPath,
      moduleSpecifier,
      resolutionKind: 'import-statement',
    });
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
    for (const element of clause.namedBindings.elements) {
      if (!element.isTypeOnly)
        bindings.set(element.name.text, {
          access: { kind: 'named', exportName: element.propertyName?.text ?? element.name.text },
          importerPath,
          moduleSpecifier,
          resolutionKind: 'import-statement',
        });
    }
}

/**
 *
 */
function collectRequireManager(
  statement: ts.VariableStatement,
  managers: Set<string>,
  namespaces: Set<string>,
): void {
  for (const declaration of statement.declarationList.declarations) {
    if (!declaration.initializer || !isStyledRequire(declaration.initializer)) continue;
    if (ts.isIdentifier(declaration.name)) namespaces.add(declaration.name.text);
    if (ts.isObjectBindingPattern(declaration.name))
      for (const element of declaration.name.elements) {
        if (
          (element.propertyName?.getText() ?? element.name.getText()) === 'StyleSheetManager' &&
          ts.isIdentifier(element.name)
        )
          managers.add(element.name.text);
      }
  }
}
/**
 *
 */
function isStyledRequire(node: ts.Expression): boolean {
  const argument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    node.arguments.length === 1 &&
    argument !== undefined &&
    ts.isStringLiteral(argument) &&
    argument.text === 'styled-components'
  );
}

/**
 *
 */
function isManagerJsx(
  node: ts.Node,
  names: Set<string>,
  namespaces: Set<string>,
): { readonly props: ts.JsxAttributes } | undefined {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return undefined;
  const tag = node.tagName;
  const identity = ts.isIdentifier(tag)
    ? names.has(tag.text)
    : ts.isPropertyAccessExpression(tag) &&
      ts.isIdentifier(tag.expression) &&
      namespaces.has(tag.expression.text) &&
      tag.name.text === 'StyleSheetManager';
  return identity ? { props: node.attributes } : undefined;
}
/**
 *
 */
function isManagerCreateElement(
  node: ts.Node,
  names: Set<string>,
  namespaces: Set<string>,
): { readonly props: ts.Expression | undefined } | undefined {
  if (
    !ts.isCallExpression(node) ||
    node.arguments.length < 2 ||
    !isReactCreateElement(node.expression)
  )
    return undefined;
  const type = node.arguments[0];
  const props = node.arguments[1];
  if (type === undefined || props === undefined) return undefined;
  const identity = ts.isIdentifier(type)
    ? names.has(type.text)
    : ts.isPropertyAccessExpression(type) &&
      ts.isIdentifier(type.expression) &&
      namespaces.has(type.expression.text) &&
      type.name.text === 'StyleSheetManager';
  return identity ? { props } : undefined;
}
/**
 *
 */
function isReactCreateElement(node: ts.Expression): boolean {
  return (
    (ts.isIdentifier(node) && node.text === 'createElement') ||
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'React' &&
      node.name.text === 'createElement')
  );
}

/**
 *
 */
function parseManagerProps(
  props: ts.JsxAttributes | ts.Expression | undefined,
  bindings: ReadonlyMap<string, PreviewStyleSheetBindingReference>,
  reasons: Set<PreviewStyleSheetManagerIgnoredReason>,
): PreviewStyleSheetManagerLayer | undefined {
  const values = new Map<string, ts.Expression | true>();
  if (props === undefined || props.kind === ts.SyntaxKind.NullKeyword)
    return { sourceKind: 'authored' };
  if (ts.isJsxAttributes(props)) {
    for (const property of props.properties) {
      if (!ts.isJsxAttribute(property)) {
        reasons.add('spread-props');
        return undefined;
      }
      if (ts.isJsxNamespacedName(property.name)) {
        reasons.add('computed-value');
        return undefined;
      }
      const initializer = property.initializer;
      values.set(
        property.name.text,
        initializer === undefined
          ? true
          : ts.isStringLiteral(initializer)
            ? initializer
            : ts.isJsxExpression(initializer)
              ? (initializer.expression ?? true)
              : true,
      );
    }
  } else if (ts.isObjectLiteralExpression(props)) {
    for (const property of props.properties) {
      if (!ts.isPropertyAssignment(property) || !isPlainPropertyName(property.name)) {
        reasons.add('spread-props');
        return undefined;
      }
      values.set(property.name.text, property.initializer);
    }
  } else {
    reasons.add('computed-value');
    return undefined;
  }
  const layer: PreviewStyleSheetManagerLayer = { sourceKind: 'authored' };
  let disableVendor: boolean | undefined;
  let enableVendor: boolean | undefined;
  for (const [name, value] of values) {
    if (
      name === 'disableCSSOMInjection' ||
      name === 'disableVendorPrefixes' ||
      name === 'enableVendorPrefixes'
    ) {
      const bool =
        value === true
          ? true
          : value.kind === ts.SyntaxKind.TrueKeyword
            ? true
            : value.kind === ts.SyntaxKind.FalseKeyword
              ? false
              : undefined;
      if (bool === undefined) {
        reasons.add('local-runtime-value');
        continue;
      }
      if (name === 'disableCSSOMInjection') Object.assign(layer, { disableCSSOMInjection: bool });
      if (name === 'disableVendorPrefixes') disableVendor = bool;
      if (name === 'enableVendorPrefixes') enableVendor = bool;
    } else if (name === 'shouldForwardProp') {
      if (value === true || !ts.isIdentifier(value) || !bindings.has(value.text)) {
        reasons.add('unresolved-binding');
        continue;
      }
      Object.assign(layer, { shouldForwardProp: bindings.get(value.text) });
    } else if (name === 'stylisPlugins') {
      const plugins = parsePlugins(value, bindings);
      if (plugins === undefined) reasons.add('unresolved-binding');
      else Object.assign(layer, { stylisPlugins: plugins });
    } else if (name === 'target' || name === 'sheet' || name === 'nonce') reasons.add(name);
    else reasons.add('unsupported-prop');
  }
  if (disableVendor !== undefined && enableVendor !== undefined) {
    reasons.add('conflicting-vendor-prefix-props');
    return undefined;
  }
  if (disableVendor !== undefined) Object.assign(layer, { disableVendorPrefixes: disableVendor });
  if (enableVendor !== undefined) Object.assign(layer, { enableVendorPrefixes: enableVendor });
  return layer;
}
/**
 *
 */
function isPlainPropertyName(
  name: ts.PropertyName,
): name is ts.Identifier | ts.StringLiteral | ts.NumericLiteral {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name);
}
/**
 *
 */
function parsePlugins(
  value: ts.Expression | true,
  bindings: ReadonlyMap<string, PreviewStyleSheetBindingReference>,
): PreviewStyleSheetManagerLayer['stylisPlugins'] | undefined {
  if (value !== true && ts.isIdentifier(value)) {
    const binding = bindings.get(value.text);
    if (binding !== undefined) return { kind: 'binding', value: binding };
  }
  if (value !== true && ts.isArrayLiteralExpression(value)) {
    const values = value.elements.map((e) =>
      ts.isIdentifier(e) ? bindings.get(e.text) : undefined,
    );
    return values.length <= 8 &&
      values.every((e): e is PreviewStyleSheetBindingReference => e !== undefined)
      ? { kind: 'binding-array', values }
      : undefined;
  }
  return undefined;
}
/**
 *
 */
function layerBindings(
  layer: PreviewStyleSheetManagerLayer,
): readonly PreviewStyleSheetBindingReference[] {
  return [
    ...(layer.shouldForwardProp ? [layer.shouldForwardProp] : []),
    ...(layer.stylisPlugins?.kind === 'binding'
      ? [layer.stylisPlugins.value]
      : (layer.stylisPlugins?.values ?? [])),
  ];
}
/**
 *
 */
function boundedReasons(
  reasons: Iterable<PreviewStyleSheetManagerIgnoredReason>,
): readonly PreviewStyleSheetManagerIgnoredReason[] {
  return [...new Set(reasons)].sort().slice(0, MAX_STYLE_SHEET_MANAGER_IGNORED_REASONS);
}
/**
 *
 */
function reasonsWith(
  reasons: Set<PreviewStyleSheetManagerIgnoredReason>,
  reason: PreviewStyleSheetManagerIgnoredReason,
): readonly PreviewStyleSheetManagerIgnoredReason[] {
  reasons.add(reason);
  return boundedReasons(reasons);
}
