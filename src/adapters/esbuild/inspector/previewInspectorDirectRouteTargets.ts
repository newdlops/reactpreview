/** Resolves direct component targets and deduplicates bounded route choices. */
import path from 'node:path';
import ts from 'typescript';
import { selectAdjacentPreviewRuntimeModule } from '../globalPackageBridge/previewGlobalPackageBridgeEvidence';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type {
  PreviewInspectorDirectRouteChoice,
  PreviewInspectorDirectRouteComponentReference,
} from './previewInspectorDirectRouteChoiceTypes';
import {
  MAXIMUM_DIRECT_ROUTE_CHOICES,
  type ParsedRouteModule,
} from './previewInspectorDirectRouteModel';
import {
  createPreviewInspectorDirectRouteOccurrenceIdentity,
  createPreviewInspectorDirectRoutePathEvidence,
  readPreviewInspectorDirectRouteCatalogHelperReference,
  readPreviewInspectorDirectRouteCatalogMemberReference,
  type PreviewInspectorDirectRouteCatalogHelperReference,
  type PreviewInspectorDirectRouteCatalogMemberReference,
} from './previewInspectorDirectRoutePathEvidence';
import {
  createComponentNameFromModuleSpecifier,
  findDynamicImportSpecifier,
  readImportedExpressionBinding,
  sourceDeclaresRuntimeName,
} from './previewInspectorDirectRouteSyntax';
import {
  collectPreviewInspectorRouteElementPath,
  type PreviewInspectorRouteElementIdentity,
} from './previewInspectorRouteElementPath';
import { readPreviewInspectorRouteBasePathReference } from './previewInspectorRoutePathMetadata';
import { normalizePreviewInspectorRoutePattern as normalizeRoutePattern } from './previewInspectorRoutePattern';

/** Adds one component expression choice after resolving its local/imported source identity. */
export function addExpressionChoice(
  expression: ts.Expression | undefined,
  rawPattern: string,
  parsed: ParsedRouteModule,
  sourcePath: string,
  choices: PreviewInspectorDirectRouteChoice[],
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
  pathResolution: PreviewInspectorDirectRouteChoice['pathResolution'] = 'resolved',
  pathExpression?: ts.Expression,
): void {
  if (expression === undefined) return;
  const identities = collectPreviewInspectorRouteElementPath(expression, parsed.sourceFile);
  const identity = identities.at(-1);
  if (identity === undefined) return;
  const pattern = normalizeRoutePattern(rawPattern);
  if (pattern === undefined) return;
  const reference = resolveComponentReference(identity, parsed, sourcePath, resolveModule);
  const routeBasePath =
    pathResolution === 'unresolved' && reference !== undefined
      ? readPreviewInspectorRouteBasePathReference(
          pathExpression,
          reference,
          identity.localName,
          sourcePath,
        )
      : undefined;
  const catalogMember = readDirectRouteCatalogMemberReference(
    pathResolution === 'unresolved' ? pathExpression : undefined,
    parsed,
    sourcePath,
    resolveModule,
  );
  const catalogHelper = readDirectRouteCatalogHelperReference(
    pathResolution === 'unresolved' ? pathExpression : undefined,
    parsed,
    sourcePath,
    resolveModule,
  );
  const pathEvidence = createPreviewInspectorDirectRoutePathEvidence({
    ...(catalogHelper === undefined ? {} : { catalogHelper }),
    ...(catalogMember === undefined ? {} : { catalogMember }),
    ...(routeBasePath === undefined ? {} : { componentBase: routeBasePath }),
    pathResolution,
  });
  const occurrenceStart = expression.getStart(parsed.sourceFile);
  const elementPath = identities.map((candidate) => {
    const candidateReference = resolveComponentReference(
      candidate,
      parsed,
      sourcePath,
      resolveModule,
    );
    return Object.freeze({
      componentName: candidate.componentName,
      ...(candidateReference === undefined ? {} : { reference: candidateReference }),
    });
  });
  addChoice(choices, {
    componentName: identity.componentName,
    elementPath: Object.freeze(elementPath),
    occurrenceIdentity: createPreviewInspectorDirectRouteOccurrenceIdentity({
      componentName: identity.componentName,
      occurrenceStart,
      pathEvidence,
      pattern,
      ...(reference === undefined ? {} : { reference }),
      sourcePath,
    }),
    occurrenceStart,
    pattern,
    pathEvidence,
    pathResolution,
    ...(routeBasePath === undefined ? {} : { routeBasePath }),
    ...(reference === undefined ? {} : { reference }),
    sourcePath,
  });
}

/** Adds a React Router lazy descriptor using its exact dynamic-import module as the page identity. */
export function addDynamicImportChoice(
  expression: ts.Expression,
  rawPattern: string,
  parsed: ParsedRouteModule,
  sourcePath: string,
  choices: PreviewInspectorDirectRouteChoice[],
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
  pathResolution: PreviewInspectorDirectRouteChoice['pathResolution'] = 'resolved',
  pathExpression?: ts.Expression,
): void {
  const moduleSpecifier = findDynamicImportSpecifier(expression);
  const pattern = normalizeRoutePattern(rawPattern);
  if (moduleSpecifier === undefined || pattern === undefined) return;
  const componentName = createComponentNameFromModuleSpecifier(moduleSpecifier);
  const resolvedPath = resolveModule?.(moduleSpecifier, sourcePath);
  const reference =
    resolvedPath === undefined
      ? undefined
      : Object.freeze({
          exportName: 'default',
          sourcePath: path.normalize(resolvedPath),
        });
  const catalogMember = readDirectRouteCatalogMemberReference(
    pathResolution === 'unresolved' ? pathExpression : undefined,
    parsed,
    sourcePath,
    resolveModule,
  );
  const catalogHelper = readDirectRouteCatalogHelperReference(
    pathResolution === 'unresolved' ? pathExpression : undefined,
    parsed,
    sourcePath,
    resolveModule,
  );
  const pathEvidence = createPreviewInspectorDirectRoutePathEvidence({
    ...(catalogHelper === undefined ? {} : { catalogHelper }),
    ...(catalogMember === undefined ? {} : { catalogMember }),
    pathResolution,
  });
  const occurrenceStart = expression.getStart(parsed.sourceFile);
  addChoice(choices, {
    componentName,
    occurrenceIdentity: createPreviewInspectorDirectRouteOccurrenceIdentity({
      componentName,
      occurrenceStart,
      pathEvidence,
      pattern,
      ...(reference === undefined ? {} : { reference }),
      sourcePath,
    }),
    occurrenceStart,
    pattern,
    pathEvidence,
    pathResolution,
    ...(reference === undefined ? {} : { reference }),
    sourcePath,
  });
}

/** Reads one exact imported registry member through inert outer one-argument wrappers. */
export function readDirectRouteCatalogMemberReference(
  expression: ts.Expression | undefined,
  parsed: ParsedRouteModule,
  sourcePath: string,
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): PreviewInspectorDirectRouteCatalogMemberReference | undefined {
  if (resolveModule === undefined) return undefined;
  return readPreviewInspectorDirectRouteCatalogMemberReference({
    expression,
    resolveRegistryBinding: (receiver) => {
      const imported = readImportedExpressionBinding(receiver, parsed);
      if (imported === undefined) return undefined;
      const registrySourcePath = resolveModule(imported.moduleSpecifier, sourcePath);
      return registrySourcePath === undefined
        ? undefined
        : {
            exportName: imported.exportName,
            sourcePath: registrySourcePath,
          };
    },
    sourceFile: parsed.sourceFile,
  });
}

/** Reads one imported path helper for later return-value catalog proof. */
export function readDirectRouteCatalogHelperReference(
  expression: ts.Expression | undefined,
  parsed: ParsedRouteModule,
  sourcePath: string,
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): PreviewInspectorDirectRouteCatalogHelperReference | undefined {
  if (resolveModule === undefined) return undefined;
  return readPreviewInspectorDirectRouteCatalogHelperReference({
    expression,
    resolveHelperBinding: (callee) => {
      const imported = readImportedExpressionBinding(callee, parsed);
      if (imported === undefined) return undefined;
      const helperSourcePath = resolveModule(imported.moduleSpecifier, sourcePath);
      return helperSourcePath === undefined
        ? undefined
        : { exportName: imported.exportName, sourcePath: helperSourcePath };
    },
    sourceFile: parsed.sourceFile,
  });
}

/** Resolves direct imports, namespace members, lazy bindings, or same-file component declarations. */
export function resolveComponentReference(
  identity: PreviewInspectorRouteElementIdentity,
  parsed: ParsedRouteModule,
  sourcePath: string,
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): PreviewInspectorDirectRouteComponentReference | undefined {
  const imported = parsed.imports.get(identity.localName);
  if (imported !== undefined) {
    const resolvedPath = resolveModule?.(imported.moduleSpecifier, sourcePath);
    if (resolvedPath === undefined) return undefined;
    const normalizedResolvedPath = path.normalize(resolvedPath);
    const componentSourcePath = /(?:^|[\\/])node_modules[\\/].+\.d\.[cm]?ts$/iu.test(
      normalizedResolvedPath,
    )
      ? (selectAdjacentPreviewRuntimeModule(normalizedResolvedPath) ?? normalizedResolvedPath)
      : normalizedResolvedPath;
    return Object.freeze({
      exportName: identity.exportName ?? imported.exportName,
      sourcePath: componentSourcePath,
    });
  }
  const initializer = parsed.initializers.get(identity.localName);
  const dynamicSpecifier =
    initializer === undefined ? undefined : findDynamicImportSpecifier(initializer);
  if (dynamicSpecifier !== undefined) {
    const resolvedPath = resolveModule?.(dynamicSpecifier, sourcePath);
    if (resolvedPath !== undefined) {
      return Object.freeze({
        exportName: identity.exportName ?? 'default',
        sourcePath: path.normalize(resolvedPath),
      });
    }
  }
  return sourceDeclaresRuntimeName(parsed, identity.localName)
    ? Object.freeze({ exportName: identity.exportName ?? identity.localName, sourcePath })
    : undefined;
}

/** Adds one deterministic, duplicate-free choice under the global metadata-only ceiling. */
export function addChoice(
  choices: PreviewInspectorDirectRouteChoice[],
  choice: PreviewInspectorDirectRouteChoice,
): void {
  const freezeChoice = (): PreviewInspectorDirectRouteChoice =>
    Object.freeze({
      componentName: choice.componentName,
      ...(choice.elementPath === undefined
        ? {}
        : {
            elementPath: Object.freeze(
              choice.elementPath.map((component) =>
                Object.freeze({
                  componentName: component.componentName,
                  ...(component.reference === undefined
                    ? {}
                    : { reference: Object.freeze(component.reference) }),
                }),
              ),
            ),
          }),
      pattern: choice.pattern,
      occurrenceIdentity: choice.occurrenceIdentity,
      occurrenceStart: choice.occurrenceStart,
      pathEvidence:
        choice.pathEvidence.kind === 'component-base'
          ? Object.freeze({
              kind: choice.pathEvidence.kind,
              reference: Object.freeze(choice.pathEvidence.reference),
            })
          : choice.pathEvidence.kind === 'catalog-member'
            ? Object.freeze({
                kind: 'catalog-member' as const,
                reference: Object.freeze({
                  ...choice.pathEvidence.reference,
                  normalizerChain: Object.freeze(choice.pathEvidence.reference.normalizerChain),
                }),
              })
            : choice.pathEvidence.kind === 'catalog-helper'
              ? Object.freeze({
                  kind: 'catalog-helper' as const,
                  reference: Object.freeze({
                    ...choice.pathEvidence.reference,
                    normalizerChain: Object.freeze(choice.pathEvidence.reference.normalizerChain),
                  }),
                })
              : Object.freeze({ kind: choice.pathEvidence.kind }),
      pathResolution: choice.pathResolution,
      ...(choice.routeBasePath === undefined
        ? {}
        : { routeBasePath: Object.freeze(choice.routeBasePath) }),
      ...(choice.reference === undefined ? {} : { reference: Object.freeze(choice.reference) }),
      sourcePath: path.normalize(choice.sourcePath),
    });
  const existingIndex = choices.findIndex(
    (candidate) => candidate.occurrenceIdentity === choice.occurrenceIdentity,
  );
  if (existingIndex >= 0) {
    const existing = choices[existingIndex];
    if (existing?.pathResolution === 'unresolved' && choice.pathResolution === 'resolved')
      choices[existingIndex] = freezeChoice();
    return;
  }
  if (choices.length >= MAXIMUM_DIRECT_ROUTE_CHOICES) return;
  choices.push(freezeChoice());
}
