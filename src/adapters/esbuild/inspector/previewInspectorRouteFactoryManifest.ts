/**
 * Combines factory-call choices, the factory implementation contract, and reachable JSON catalogs.
 *
 * The collector is intentionally a bridge between small syntax readers. A missing proof yields an
 * unresolved choice, never a wildcard fallback or an eagerly evaluated project module.
 */
import path from 'node:path';
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import { collectPreviewInspectorRouteFactoryCatalog } from './previewInspectorRouteFactoryCatalog';
import { resolvePreviewInspectorRouteFactoryDefinition } from './previewInspectorRouteFactoryDefinition';
import { collectPreviewInspectorRouteFactoryChoices } from './previewInspectorRouteFactoryChoices';
import type {
  PreviewInspectorFactoryFallbackEntry,
  PreviewInspectorFactoryRouteEntry,
  PreviewInspectorRouteFactoryManifest,
} from './previewInspectorRouteFactoryManifestTypes';
import { relativizePreviewInspectorRoutePattern } from './previewInspectorRoutePatternMatch';

/** Builds one route manifest for the selected factory export, or returns undefined when not a factory. */
export async function collectPreviewInspectorRouteFactoryManifest(options: {
  readonly exportName: string;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePath: string;
  readonly sourceText: string | undefined;
}): Promise<PreviewInspectorRouteFactoryManifest | undefined> {
  if (options.sourceText === undefined) return undefined;
  const sourceFile = parseSource(options.sourcePath, options.sourceText);
  const identities = new Set([options.exportName]);
  const inventory = collectPreviewInspectorRouteFactoryChoices({
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    sourcePath: options.sourcePath,
    sourceText: options.sourceText,
    targetIdentities: identities,
  });
  const owner = inventory.owner;
  if (owner === undefined) return undefined;
  const callExpression = findOwnerFactoryCall(sourceFile, owner.exportName);
  if (callExpression === undefined) return undefined;
  const definition = await resolvePreviewInspectorRouteFactoryDefinition({
    callExpression,
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    sourceFile,
    sourcePath: options.sourcePath,
  });
  const dependencies = new Set<string>([
    path.normalize(options.sourcePath),
    ...(definition?.dependencyPaths ?? []),
  ]);
  const pageChoices = inventory.choices.filter(
    (choice) =>
      choice.localName !== undefined &&
      !isSubmoduleChoice(choice.componentName, callExpression, sourceFile),
  );
  const submoduleChoices = inventory.choices.filter((choice) => !pageChoices.includes(choice));
  const catalog =
    definition?.catalogBindingName === undefined
      ? undefined
      : await collectCatalogFromDependencies(
          definition.dependencyPaths,
          definition.catalogBindingName,
          new Set(pageChoices.map((choice) => choice.componentName)),
          options,
        );
  for (const dependency of catalog?.dependencyPaths ?? [])
    dependencies.add(path.normalize(dependency));
  const routes: PreviewInspectorFactoryRouteEntry[] = [];
  const unresolved = new Set<string>();
  for (const choice of pageChoices) {
    const pattern = catalog?.patternsByComponentName.get(choice.componentName)?.[0];
    const relative =
      pattern === undefined
        ? undefined
        : relativizePreviewInspectorRoutePattern(owner.basePath, pattern);
    if (pattern === undefined || relative === undefined) {
      unresolved.add(choice.componentName);
      continue;
    }
    const reference = inventory.references.get(choice.componentName);
    routes.push(
      Object.freeze({
        absolutePattern: pattern,
        ...(reference === undefined
          ? {}
          : {
              componentExportName: reference.exportName,
              componentSourcePath: reference.sourcePath,
            }),
        componentName: choice.componentName,
        kind: 'page',
        relativeRouterPattern: relative,
      }),
    );
  }
  for (const choice of submoduleChoices) {
    const reference = inventory.references.get(choice.componentName);
    const basePattern =
      reference === undefined
        ? undefined
        : await readImportedFactoryBase(
            reference.sourcePath,
            reference.exportName,
            options.readSource,
          );
    const relative =
      basePattern === undefined
        ? undefined
        : relativizePreviewInspectorRoutePattern(owner.basePath, basePattern);
    if (basePattern === undefined || relative === undefined) {
      unresolved.add(choice.componentName);
      continue;
    }
    routes.push(
      Object.freeze({
        absolutePattern: basePattern,
        componentExportName: reference?.exportName ?? 'default',
        componentName: choice.componentName,
        componentSourcePath: reference?.sourcePath ?? '',
        kind: 'submodule',
        relativeRouterPattern: relative.length === 0 ? '*' : `${relative}/*`,
      }),
    );
  }
  const fallbacks = owner.hasWildcardFallback
    ? Object.freeze(readLiteralFallbacks(callExpression, sourceFile))
    : Object.freeze([]);
  return Object.freeze({
    basePattern: owner.basePath,
    dependencies: Object.freeze([...dependencies]),
    fallbacks,
    ownerExportName: owner.exportName,
    ownerSourcePath: owner.sourcePath,
    routes: Object.freeze(routes),
    routeSlotCount: owner.routeSlotCount,
    unresolvedChoiceNames: Object.freeze([...unresolved]),
  });
}

/** Attempts catalog lookup from each proven dependency because a curry closes over caller bindings. */
async function collectCatalogFromDependencies(
  dependencies: readonly string[],
  bindingName: string,
  expectedComponentNames: ReadonlySet<string>,
  options: Parameters<typeof collectPreviewInspectorRouteFactoryManifest>[0],
): Promise<Awaited<ReturnType<typeof collectPreviewInspectorRouteFactoryCatalog>> | undefined> {
  for (const dependency of dependencies) {
    const catalog = await collectPreviewInspectorRouteFactoryCatalog({
      catalogBindingName: bindingName,
      expectedComponentNames,
      readSource: options.readSource,
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      sourcePath: dependency,
    });
    if (catalog.patternsByComponentName.size > 0) return catalog;
  }
  return undefined;
}

/** Separates second-call-argument pages from third-call-argument submodule values by source syntax. */
function isSubmoduleChoice(
  name: string,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): boolean {
  const argument = call.arguments[2];
  if (argument === undefined) return false;
  return argument.getText(sourceFile).includes(name);
}

/** Reads a submodule's own factory base from a direct exported route-factory assignment. */
async function readImportedFactoryBase(
  sourcePath: string,
  exportName: string,
  readSource: (sourcePath: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  const sourceText = await readSource(sourcePath);
  if (sourceText === undefined) return undefined;
  const sourceFile = parseSource(sourcePath, sourceText);
  const initializer = findExportInitializer(sourceFile, exportName);
  if (initializer === undefined || !ts.isCallExpression(initializer)) return undefined;
  const argument = initializer.arguments[0];
  return argument !== undefined && ts.isStringLiteralLike(argument) && argument.text.startsWith('/')
    ? argument.text
    : undefined;
}

/** Locates the selected export's direct factory call without descending into unrelated declarations. */
function findOwnerFactoryCall(
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.CallExpression | undefined {
  const initializer = findExportInitializer(sourceFile, exportName);
  return initializer !== undefined && ts.isCallExpression(initializer) ? initializer : undefined;
}

/** Reads literal wildcard elements for diagnostics while keeping them out of ordinary routes. */
function readLiteralFallbacks(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): PreviewInspectorFactoryFallbackEntry[] {
  const result: PreviewInspectorFactoryFallbackEntry[] = [];
  const visit = (node: ts.Node): void => {
    const route = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : undefined;
    if (
      route?.tagName.getText(sourceFile) === 'Route' &&
      route.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          ts.isIdentifier(attribute.name) &&
          attribute.name.text === 'path' &&
          attribute.initializer !== undefined &&
          ts.isStringLiteral(attribute.initializer) &&
          attribute.initializer.text === '*',
      )
    ) {
      const text = route.getText(sourceFile);
      const match = /element=\{<([$_\p{L}][$_\p{L}\p{N}]*)/u.exec(text);
      if (match?.[1] !== undefined)
        result.push(
          Object.freeze({
            componentName: match[1],
            occurrenceStart: node.getStart(sourceFile),
            pattern: '*',
          }),
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(call);
  return result;
}

/** Finds an export assignment or exported const initializer by public binding name. */
function findExportInitializer(
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (exportName === 'default' && ts.isExportAssignment(statement)) return statement.expression;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === exportName &&
        declaration.initializer !== undefined
      )
        return declaration.initializer;
    }
  }
  return undefined;
}

/** Parses source snapshot text without building a TypeScript program. */
function parseSource(sourcePath: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}
