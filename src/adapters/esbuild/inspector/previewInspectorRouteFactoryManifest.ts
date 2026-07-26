/** Builds a complete, non-executing route-choice manifest for one factory export. */
import path from 'node:path';
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import { collectPreviewInspectorRouteFactoryCatalog } from './previewInspectorRouteFactoryCatalog';
import { resolvePreviewInspectorRouteFactoryDefinition } from './previewInspectorRouteFactoryDefinition';
import {
  collectPreviewInspectorRouteFactoryChoices,
  createPreviewInspectorRouteFactoryChoiceKey,
} from './previewInspectorRouteFactoryChoices';
import { resolvePreviewInspectorRouteFactoryOwner } from './previewInspectorRouteFactoryOwner';
import type {
  PreviewInspectorFactoryFallbackEntry,
  PreviewInspectorFactoryRouteEntry,
  PreviewInspectorFactoryRouteOption,
  PreviewInspectorRouteFactoryManifest,
} from './previewInspectorRouteFactoryManifestTypes';
import { relativizePreviewInspectorRoutePattern } from './previewInspectorRoutePatternMatch';

/**
 *
 */
/** Collects every factory choice before classifying safely resolved routes. */
export async function collectPreviewInspectorRouteFactoryManifest(options: {
  readonly exportName: string;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePath: string;
  readonly sourceText: string | undefined;
}): Promise<PreviewInspectorRouteFactoryManifest | undefined> {
  if (options.sourceText === undefined) return undefined;
  const sourceFile = parse(options.sourcePath, options.sourceText);
  const choices = collectPreviewInspectorRouteFactoryChoices({
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    sourcePath: options.sourcePath,
    sourceText: options.sourceText,
    targetIdentities: new Set([options.exportName]),
  });
  const owner = choices.owner;
  const call = owner === undefined ? undefined : findExportCall(sourceFile, owner.exportName);
  if (owner === undefined || call === undefined) return undefined;
  const definition = await resolvePreviewInspectorRouteFactoryDefinition({
    callExpression: call,
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    sourceFile,
    sourcePath: options.sourcePath,
  });
  const dependencies = new Set([
    path.normalize(options.sourcePath),
    ...(definition?.dependencyPaths ?? []),
  ]);
  const pageChoices = choices.choices.filter((choice) => choice.kind === 'page');
  const catalog =
    definition?.catalogBindingName === undefined
      ? undefined
      : await collectCatalog(
          definition.dependencyPaths,
          definition.catalogBindingName,
          new Set(pageChoices.map((choice) => choice.componentName)),
          options,
        );
  for (const dependency of catalog?.dependencyPaths ?? [])
    dependencies.add(path.normalize(dependency));
  const routes: PreviewInspectorFactoryRouteEntry[] = [];
  const routeOptions: PreviewInspectorFactoryRouteOption[] = [];
  const unresolved = new Set<string>();
  for (const choice of choices.choices) {
    const reference =
      choices.references.get(createPreviewInspectorRouteFactoryChoiceKey(choice)) ??
      choices.references.get(choice.componentName);
    if (definition === undefined) {
      unresolved.add(choice.componentName);
      routeOptions.push(freezeOption(choice, 'factory-contract-unresolved'));
      continue;
    }
    if (choice.kind === 'page') {
      const patterns = catalog?.patternsByComponentName.get(choice.componentName);
      if (patterns === undefined || patterns.length === 0) {
        unresolved.add(choice.componentName);
        routeOptions.push(freezeOption(choice, 'catalog-unresolved'));
        continue;
      }
      for (const pattern of patterns) {
        const relative = relativizePreviewInspectorRoutePattern(owner.basePath, pattern);
        if (relative === undefined) {
          unresolved.add(choice.componentName);
          routeOptions.push(freezeOption(choice, 'catalog-unresolved'));
          continue;
        }
        const route = Object.freeze({
          absolutePattern: pattern,
          ...(reference === undefined
            ? {}
            : {
                componentExportName: reference.exportName,
                componentSourcePath: reference.sourcePath,
              }),
          componentName: choice.componentName,
          kind: 'page' as const,
          relativeRouterPattern: relative,
        });
        routes.push(route);
        routeOptions.push(freezeOption(choice, 'selectable', route));
      }
      continue;
    }
    if (reference === undefined) {
      unresolved.add(choice.componentName);
      routeOptions.push(freezeOption(choice, 'component-unresolved'));
      continue;
    }
    const nested = await resolvePreviewInspectorRouteFactoryOwner({
      exportName: reference.exportName,
      readSource: options.readSource,
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      sourcePath: reference.sourcePath,
    });
    const relative =
      nested === undefined
        ? undefined
        : relativizePreviewInspectorRoutePattern(owner.basePath, nested.basePattern);
    if (nested === undefined || relative === undefined) {
      unresolved.add(choice.componentName);
      routeOptions.push(freezeOption(choice, 'submodule-base-unresolved'));
      continue;
    }
    for (const dependency of nested.dependencyPaths) dependencies.add(path.normalize(dependency));
    const route = Object.freeze({
      absolutePattern: nested.basePattern,
      componentExportName: reference.exportName,
      componentName: choice.componentName,
      componentSourcePath: reference.sourcePath,
      kind: 'submodule' as const,
      relativeRouterPattern: relative.length === 0 ? '*' : `${relative}/*`,
    });
    routes.push(route);
    routeOptions.push(freezeOption(choice, 'selectable', route));
  }
  const fallbacks = owner.hasWildcardFallback
    ? Object.freeze(readFallbacks(call, sourceFile))
    : Object.freeze([]);
  return Object.freeze({
    basePattern: owner.basePath,
    dependencies: Object.freeze([...dependencies].sort()),
    fallbacks,
    options: Object.freeze(routeOptions.sort((a, b) => a.occurrenceStart - b.occurrenceStart)),
    ownerExportName: owner.exportName,
    ownerSourcePath: owner.sourcePath,
    routes: Object.freeze(routes),
    routeSlotCount: owner.routeSlotCount,
    unresolvedChoiceNames: Object.freeze([...unresolved]),
  });
}

/**
 *
 */
/** Freezes one visible route option without exposing parser nodes. */
function freezeOption(
  choice: { componentName: string; kind: 'page' | 'submodule'; occurrenceStart: number },
  availability: PreviewInspectorFactoryRouteOption['availability'],
  route?: PreviewInspectorFactoryRouteEntry,
): PreviewInspectorFactoryRouteOption {
  return Object.freeze({
    availability,
    componentName: choice.componentName,
    kind: choice.kind,
    occurrenceStart: choice.occurrenceStart,
    ...(route === undefined ? {} : { route }),
  });
}

/**
 *
 */
/** Merges every bounded catalog result because curry closures can originate in several modules. */
async function collectCatalog(
  dependencies: readonly string[],
  catalogBindingName: string,
  expectedComponentNames: ReadonlySet<string>,
  options: Parameters<typeof collectPreviewInspectorRouteFactoryManifest>[0],
): Promise<Awaited<ReturnType<typeof collectPreviewInspectorRouteFactoryCatalog>> | undefined> {
  let result: Awaited<ReturnType<typeof collectPreviewInspectorRouteFactoryCatalog>> | undefined;
  for (const sourcePath of dependencies) {
    const catalog = await collectPreviewInspectorRouteFactoryCatalog({
      catalogBindingName,
      expectedComponentNames,
      maximumModules: 12,
      readSource: options.readSource,
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      sourcePath,
    });
    if (catalog.patternsByComponentName.size === 0) continue;
    if (result === undefined) result = catalog;
    else {
      const patterns = new Map(result.patternsByComponentName);
      for (const [name, values] of catalog.patternsByComponentName)
        patterns.set(
          name,
          Object.freeze([
            ...(patterns.get(name) ?? []),
            ...values.filter((value) => !(patterns.get(name) ?? []).includes(value)),
          ]),
        );
      result = Object.freeze({
        dependencyPaths: Object.freeze([
          ...new Set([...result.dependencyPaths, ...catalog.dependencyPaths]),
        ]),
        patternsByComponentName: patterns,
      });
    }
  }
  return result;
}

/**
 *
 */
/** Finds the exact direct factory invocation assigned to one exported owner. */
function findExportCall(
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.CallExpression | undefined {
  let expression: ts.Expression | undefined;
  for (const statement of sourceFile.statements) {
    if (exportName === 'default' && ts.isExportAssignment(statement))
      expression = statement.expression;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName)
        expression = declaration.initializer;
  }
  return expression !== undefined && ts.isCallExpression(unwrap(expression))
    ? (unwrap(expression) as ts.CallExpression)
    : undefined;
}

/**
 *
 */
/** Retains literal wildcard diagnostics separately from normal selectable routes. */
function readFallbacks(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): PreviewInspectorFactoryFallbackEntry[] {
  const fallbacks: PreviewInspectorFactoryFallbackEntry[] = [];
  const visit = (node: ts.Node): void => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : undefined;
    if (
      opening?.tagName.getText(sourceFile) === 'Route' &&
      opening.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          ts.isIdentifier(attribute.name) &&
          attribute.name.text === 'path' &&
          attribute.initializer !== undefined &&
          ts.isStringLiteral(attribute.initializer) &&
          attribute.initializer.text === '*',
      )
    ) {
      const match = /element=\{<([$_\p{L}][$_\p{L}\p{N}]*)/u.exec(opening.getText(sourceFile));
      if (match?.[1] !== undefined)
        fallbacks.push(
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
  return fallbacks;
}

/**
 *
 */
/** Parses one snapshot without creating a TypeScript program. */
function parse(sourcePath: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    sourcePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}
/**
 *
 */
/** Removes type-only expression wrappers. */
function unwrap(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isTypeAssertionExpression(value)
  )
    value = value.expression;
  return value;
}
