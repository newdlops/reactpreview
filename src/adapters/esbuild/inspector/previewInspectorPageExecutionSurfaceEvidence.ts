/* eslint-disable jsdoc/require-jsdoc */
/** Reads bounded source evidence for importable page surfaces, tabs, and router ownership. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { PreviewRenderChainCandidate } from '../renderGraph';
import type {
  PreviewInspectorComponentReference,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';
import type {
  PreviewInspectorMountSurface,
  PreviewInspectorRouteExecutionRecipe,
} from './previewInspectorPageExecutionTypes';
import { resolvePreviewReactLocalComponentSurface } from '../staticResources/previewReactLocalComponentSurface';
import { collectPreviewRouterRequirement } from '../previewRouterRequirement';

/** Creates an authentic source/export surface without evaluating the module. */
export function createAuthenticSurface(
  reference: PreviewInspectorComponentReference,
  prefix: string,
): PreviewInspectorMountSurface {
  const sourcePath = path.normalize(reference.sourcePath);
  return Object.freeze({
    bypassedWrapperNames: Object.freeze([]),
    exportName: reference.exportName,
    id: createSurfaceId(prefix, reference),
    omittedTopLevelEffectCount: 0,
    sourcePath,
    strategy: 'authentic-module-export',
    watchSourcePaths: Object.freeze([sourcePath]),
  });
}

/** Uses a virtual same-file closure for the selected page export; load-time parsing can fail closed. */
/** Admits one selected-export slice while preserving its exact source identity. */
export function createSelectedExportSurface(
  reference: PreviewInspectorComponentReference,
  prefix: string,
): PreviewInspectorMountSurface {
  const sourcePath = path.normalize(reference.sourcePath);
  return Object.freeze({
    bypassedWrapperNames: Object.freeze([]),
    exportName: reference.exportName,
    id: createSurfaceId(`${prefix}-slice`, reference),
    omittedTopLevelEffectCount: 0,
    sourcePath,
    strategy: 'selected-export-slice',
    watchSourcePaths: Object.freeze([sourcePath]),
  });
}

/** Reads a bounded same-file local HOC body; unknown wrappers remain outside automatic variants. */
/** Recovers a statically proven local component slice; unknown exports stay unavailable. */
export function createLocalComponentSurface(
  reference: PreviewInspectorComponentReference,
  prefix: string,
): PreviewInspectorMountSurface | undefined {
  const sourceText = readSource(reference.sourcePath);
  if (sourceText === undefined) return undefined;
  const resolved = resolvePreviewReactLocalComponentSurface({
    exportName: reference.exportName,
    sourcePath: reference.sourcePath,
    sourceText,
  });
  if (resolved?.localName === undefined || resolved.bypassedWrapperNames.length === 0)
    return undefined;
  const sourcePath = path.normalize(reference.sourcePath);
  return Object.freeze({
    bypassedWrapperNames: resolved.bypassedWrapperNames,
    exportName: 'default',
    id: `${createSurfaceId(`${prefix}-local`, reference)}:${resolved.localName}`,
    localName: resolved.localName,
    omittedTopLevelEffectCount: 0,
    preservedWrapperKinds: resolved.preservedWrapperKinds,
    sourcePath,
    strategy: 'inner-local-component-slice',
    watchSourcePaths: Object.freeze([sourcePath]),
  });
}

const PREVIEW_INSPECTOR_TRANSIENT_SURFACE_WORDS = new Set([
  'fallback',
  'loader',
  'loading',
  'pending',
  'placeholder',
  'progress',
  'shimmer',
  'skeleton',
  'spinner',
]);

/**
 * Promotes the nearest importable loading-state owner on the exact selected path. The target must
 * itself be transient, which prevents ordinary components nested beneath an unrelated spinner or
 * progress indicator from silently changing their execution root.
 */
export function createTransientContextSurface(
  renderPath: PreviewRenderChainCandidate | undefined,
  browserCandidate: PreviewInspectorPageCandidate,
  target: PreviewInspectorComponentReference,
): PreviewInspectorMountSurface | undefined {
  if (renderPath === undefined || !hasTransientSurfaceWord(target.exportName)) return undefined;
  const normalizedTargetPath = path.normalize(target.sourcePath);
  const exactRootStepIndex = renderPath.steps.findIndex(
    (step) =>
      path.normalize(step.sourcePath) === path.normalize(browserCandidate.root.sourcePath) &&
      normalizeRenderStepExportName(step.label) === browserCandidate.root.exportName,
  );
  const corridorEnd =
    browserCandidate.rootStepIndex ??
    (exactRootStepIndex >= 0 ? exactRootStepIndex : renderPath.steps.length - 1);
  for (let index = 1; index <= corridorEnd; index += 1) {
    const step = renderPath.steps[index];
    if (step === undefined || !hasTransientSurfaceWord(step.label)) continue;
    const exportName = normalizeRenderStepExportName(step.label);
    const sourcePath = path.normalize(step.sourcePath);
    if (
      exportName === undefined ||
      (sourcePath === normalizedTargetPath && exportName === target.exportName) ||
      !sourceExportsRuntimeValue(sourcePath, exportName)
    ) {
      continue;
    }
    return createAuthenticSurface(Object.freeze({ exportName, sourcePath }), 'transient-context');
  }
  return undefined;
}

function hasTransientSurfaceWord(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .map((word) => word.toLowerCase());
  return words.some((word) => PREVIEW_INSPECTOR_TRANSIENT_SURFACE_WORDS.has(word));
}

function normalizeRenderStepExportName(label: string): string | undefined {
  if (label === '@default') return 'default';
  return /^[$A-Z_a-z][$0-9A-Z_a-z]*$/u.test(label) ? label : undefined;
}

/** Fails closed for local-only declarations and type-only exports. */
function sourceExportsRuntimeValue(sourcePath: string, exportName: string): boolean {
  const sourceText = readSource(sourcePath);
  if (sourceText === undefined) return false;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith('.tsx') || sourcePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
  const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
    (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
      (modifier) => modifier.kind === kind,
    ) === true;
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      if (exportName === 'default' && !statement.isExportEquals) return true;
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      if (exportName === 'default' && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        return true;
      }
      if (statement.name?.text === exportName) return true;
      continue;
    }
    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === exportName,
      )
    ) {
      return true;
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(
        (element) => !element.isTypeOnly && element.name.text === exportName,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Limits candidate analysis to the same source ceiling as Frontier v2. */
export function readSource(sourcePath: string): string | undefined {
  try {
    const sourceText = readFileSync(sourcePath, 'utf8');
    return Buffer.byteLength(sourceText, 'utf8') <= 1024 * 1024 ? sourceText : undefined;
  } catch {
    return undefined;
  }
}

const PREVIEW_INSPECTOR_TARGET_PAGE_TAB_KEY_LIMIT = 8;
const PREVIEW_INSPECTOR_TARGET_PAGE_TAB_WRAPPERS = new Set(['TabItem', 'TabPane', 'TabPanel']);

/**
 * Reads only literal event keys from exact JSX ancestors retained by the selected render path.
 * Dynamic keys and merely adjacent tabs fail closed instead of becoming browser actions.
 */
export function collectPreviewInspectorTargetPageTabKeys(
  renderPath: PreviewInspectorPageCandidate['renderPath'],
): readonly string[] {
  if (renderPath === undefined) return Object.freeze([]);
  const innerToOuterKeys: string[] = [];
  for (const step of renderPath.steps) {
    if (
      step.invocation?.mode !== 'jsx' ||
      !step.wrapperNames.some((name) =>
        PREVIEW_INSPECTOR_TARGET_PAGE_TAB_WRAPPERS.has(name.split('.').at(-1) ?? ''),
      )
    ) {
      continue;
    }
    const sourcePath = step.invocation.sourcePath ?? step.sourcePath;
    const sourceText = readSource(sourcePath);
    if (
      sourceText === undefined ||
      step.occurrenceStart < 0 ||
      step.occurrenceStart >= sourceText.length
    ) {
      continue;
    }
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let current = findDeepestPreviewInspectorNodeAtPosition(sourceFile, step.occurrenceStart);
    while (!ts.isSourceFile(current)) {
      if (ts.isJsxElement(current)) {
        const tagName = current.openingElement.tagName.getText(sourceFile).split('.').at(-1) ?? '';
        if (
          PREVIEW_INSPECTOR_TARGET_PAGE_TAB_WRAPPERS.has(tagName) &&
          step.wrapperNames.some((name) => name.split('.').at(-1) === tagName)
        ) {
          const eventKey = readPreviewInspectorStaticJsxStringAttribute(
            current.openingElement.attributes,
            'eventKey',
          );
          if (eventKey !== undefined) innerToOuterKeys.push(eventKey);
        }
      }
      current = current.parent;
    }
  }
  const keys = [...new Set(innerToOuterKeys.reverse())].slice(
    0,
    PREVIEW_INSPECTOR_TARGET_PAGE_TAB_KEY_LIMIT,
  );
  return Object.freeze(keys);
}

/** Finds the narrowest parsed node that contains one analyzer-owned occurrence offset. */
function findDeepestPreviewInspectorNodeAtPosition(node: ts.Node, position: number): ts.Node {
  let match = node;
  node.forEachChild((child) => {
    if (child.getFullStart() <= position && position < child.getEnd()) {
      match = findDeepestPreviewInspectorNodeAtPosition(child, position);
    }
  });
  return match;
}

/** Accepts string literals and no-substitution template literals, never evaluated expressions. */
function readPreviewInspectorStaticJsxStringAttribute(
  attributes: ts.JsxAttributes,
  attributeName: string,
): string | undefined {
  for (const property of attributes.properties) {
    if (
      !ts.isJsxAttribute(property) ||
      !ts.isIdentifier(property.name) ||
      property.name.text !== attributeName
    ) {
      continue;
    }
    const initializer = property.initializer;
    const value =
      initializer !== undefined && ts.isStringLiteral(initializer)
        ? initializer.text
        : initializer !== undefined &&
            ts.isJsxExpression(initializer) &&
            initializer.expression !== undefined &&
            (ts.isStringLiteral(initializer.expression) ||
              ts.isNoSubstitutionTemplateLiteral(initializer.expression))
          ? initializer.expression.text
          : undefined;
    return value !== undefined && value.length > 0 && value.length <= 128 ? value : undefined;
  }
  return undefined;
}

/**
 * A route recipe may retain an imported local name when static evidence cannot prove whether the
 * authored module exports that name or its default. Keep that legacy-compatible uncertainty at the
 * mount boundary instead of turning a valid default-exported layout into a build failure.
 */
export function createModuleFallbackSurface(
  reference: PreviewInspectorComponentReference,
  prefix: string,
): PreviewInspectorMountSurface {
  const sourcePath = path.normalize(reference.sourcePath);
  return Object.freeze({
    bypassedWrapperNames: Object.freeze([]),
    exportName: reference.exportName,
    id: createSurfaceId(prefix, reference),
    omittedTopLevelEffectCount: 0,
    sourcePath,
    strategy: 'selected-route-surface',
    watchSourcePaths: Object.freeze([sourcePath]),
  });
}

/** Keeps one source/export identity in the execution import list. */
export function deduplicateSurfaces(
  surfaces: readonly PreviewInspectorMountSurface[],
): readonly PreviewInspectorMountSurface[] {
  const identities = new Set<string>();
  return Object.freeze(
    surfaces.filter((surface) => {
      const identity = `${path.normalize(surface.sourcePath)}\0${surface.exportName}`;
      if (identities.has(identity)) return false;
      identities.add(identity);
      return true;
    }),
  );
}

/**
 * Recomputes Router ownership for the live execution root after an authored app root is stripped.
 *
 * A selected route surface can live below an AppRouter that owns RouterProvider. Reusing the
 * authored root flag would omit the MemoryRouter even though the generated slice now begins at a
 * component that only consumes Route context.
 */
export function doesPreviewInspectorSurfaceOwnRouter(
  surface: PreviewInspectorMountSurface,
): boolean | undefined {
  const sourceText = readSource(surface.sourcePath);
  if (sourceText === undefined) return undefined;
  return collectPreviewRouterRequirement(surface.sourcePath, sourceText).ownsRouter;
}

/** Distinguishes only statically authored v5/v6 route syntax; unknown routers stay generic. */
export function readRouteRuntime(
  location: NonNullable<PreviewInspectorPageCandidate['routeLocation']>,
): Pick<PreviewInspectorRouteExecutionRecipe, 'kind' | 'routerModuleSpecifier'> {
  if (location.evidenceKind === 'next-app-filesystem') return { kind: 'next-app' };
  if (
    location.evidenceKind === 'next-pages-filesystem' ||
    location.evidenceKind === 'next-pages-synthetic'
  )
    return { kind: 'next-pages' };
  const sources = [
    location.sourcePath,
    ...('routeMounts' in location
      ? (location.routeMounts ?? []).map((mount) => mount.sourcePath)
      : []),
  ];
  return readReactRouterRuntime(sources);
}

/** Reads the exact React Router package and generation from bounded authored sources. */
export function readReactRouterRuntime(
  sources: readonly string[],
): Pick<PreviewInspectorRouteExecutionRecipe, 'kind' | 'routerModuleSpecifier'> {
  const sourceEntries = sources.flatMap((sourcePath) => {
    const sourceText = readSource(sourcePath);
    return sourceText === undefined ? [] : [{ sourcePath, sourceText }];
  });
  const evidence = collectReactRouterImportEvidence(sourceEntries);
  const routerModuleSpecifier = evidence.moduleSpecifiers.has('react-router-dom')
    ? 'react-router-dom'
    : evidence.moduleSpecifiers.has('react-router')
      ? 'react-router'
      : undefined;
  if (routerModuleSpecifier === undefined) return { kind: 'generic-memory-location' };
  if (
    [
      'Routes',
      'RouterProvider',
      'useRoutes',
      'createBrowserRouter',
      'createHashRouter',
      'createMemoryRouter',
    ].some((binding) => evidence.importedExports.has(binding))
  )
    return { kind: 'react-router-v6', routerModuleSpecifier };
  if (
    ['Switch', 'withRouter'].some((binding) => evidence.importedExports.has(binding)) ||
    sourceEntries.some(({ sourceText }) => /\b(?:component|render)\s*=/u.test(sourceText))
  )
    return { kind: 'react-router-v5', routerModuleSpecifier };
  return { kind: 'generic-memory-location' };
}

/** Reads only bindings imported from React Router, excluding unrelated local names such as Routes. */
function collectReactRouterImportEvidence(
  sources: readonly { readonly sourcePath: string; readonly sourceText: string }[],
): {
  readonly importedExports: ReadonlySet<string>;
  readonly moduleSpecifiers: ReadonlySet<string>;
} {
  const importedExports = new Set<string>();
  const moduleSpecifiers = new Set<string>();
  for (const { sourcePath, sourceText } of sources) {
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const namespaceBindings = new Set<string>();
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteralLike(statement.moduleSpecifier) ||
        !['react-router', 'react-router-dom'].includes(statement.moduleSpecifier.text)
      ) {
        continue;
      }
      moduleSpecifiers.add(statement.moduleSpecifier.text);
      const namedBindings = statement.importClause?.namedBindings;
      if (namedBindings === undefined) continue;
      if (ts.isNamespaceImport(namedBindings)) {
        namespaceBindings.add(namedBindings.name.text);
        continue;
      }
      for (const element of namedBindings.elements) {
        importedExports.add(element.propertyName?.text ?? element.name.text);
      }
    }
    if (namespaceBindings.size === 0) continue;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaceBindings.has(node.expression.text)
      ) {
        importedExports.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { importedExports, moduleSpecifiers };
}

/** Hashes a stable source/export identity for one surface role. */
function createSurfaceId(prefix: string, reference: PreviewInspectorComponentReference): string {
  return `${prefix}:${createHash('sha256')
    .update(`${path.normalize(reference.sourcePath)}\0${reference.exportName}`)
    .digest('hex')
    .slice(0, 20)}`;
}
