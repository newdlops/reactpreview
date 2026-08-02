/** Compiler-only exact provenance for one authored direct route path occurrence. */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewInspectorRouteBasePathReference } from './previewInspectorRoutePathMetadata';

/** Resolved source identity for the component rendered by one direct route. */
export interface PreviewInspectorDirectRoutePathComponentReference {
  readonly exportName: string;
  readonly sourcePath: string;
}

/** Exact imported registry member used by one authored dynamic route path. */
export interface PreviewInspectorDirectRouteCatalogMemberReference {
  readonly catalogKey: string;
  readonly normalizerChain: readonly string[];
  readonly registryExportName: string;
  readonly registrySourcePath: string;
}

/** Classifies the bounded source evidence attached to one direct route occurrence. */
export type PreviewInspectorDirectRoutePathEvidence =
  | { readonly kind: 'literal' }
  | {
      readonly kind: 'component-base';
      readonly reference: PreviewInspectorRouteBasePathReference;
    }
  | {
      readonly kind: 'catalog-member';
      readonly reference: PreviewInspectorDirectRouteCatalogMemberReference;
    }
  | { readonly kind: 'unresolved' };

/** Chooses one exclusive evidence channel after syntax extraction. */
export function createPreviewInspectorDirectRoutePathEvidence(options: {
  readonly catalogMember?: PreviewInspectorDirectRouteCatalogMemberReference;
  readonly componentBase?: PreviewInspectorRouteBasePathReference;
  readonly pathResolution: 'resolved' | 'unresolved';
}): PreviewInspectorDirectRoutePathEvidence {
  if (options.pathResolution === 'resolved') return Object.freeze({ kind: 'literal' });
  if (options.componentBase !== undefined) {
    return Object.freeze({ kind: 'component-base', reference: options.componentBase });
  }
  if (options.catalogMember !== undefined) {
    return Object.freeze({ kind: 'catalog-member', reference: options.catalogMember });
  }
  return Object.freeze({ kind: 'unresolved' });
}

/** Reads one static registry member through inert outer one-argument wrappers. */
export function readPreviewInspectorDirectRouteCatalogMemberReference(options: {
  readonly expression: ts.Expression | undefined;
  readonly resolveRegistryBinding: (
    expression: ts.Expression,
  ) =>
    | {
        readonly exportName: string;
        readonly sourcePath: string;
      }
    | undefined;
  readonly sourceFile: ts.SourceFile;
}): PreviewInspectorDirectRouteCatalogMemberReference | undefined {
  if (options.expression === undefined) return undefined;
  const normalizerChain: string[] = [];
  let current = unwrap(options.expression);
  while (
    ts.isCallExpression(current) &&
    current.arguments.length === 1 &&
    current.arguments[0] !== undefined
  ) {
    normalizerChain.push(current.expression.getText(options.sourceFile));
    current = unwrap(current.arguments[0]);
  }
  if (
    !ts.isElementAccessExpression(current) ||
    !ts.isStringLiteralLike(unwrap(current.argumentExpression))
  ) {
    return undefined;
  }
  const argument = unwrap(current.argumentExpression);
  if (!ts.isStringLiteralLike(argument)) return undefined;
  const registry = options.resolveRegistryBinding(current.expression);
  if (registry === undefined || registry.exportName === '*') return undefined;
  return Object.freeze({
    catalogKey: argument.text,
    normalizerChain: Object.freeze(normalizerChain),
    registryExportName: registry.exportName,
    registrySourcePath: path.normalize(registry.sourcePath),
  });
}

/** Canonical occurrence identity; component names never correlate independent occurrences. */
export function createPreviewInspectorDirectRouteOccurrenceIdentity(input: {
  readonly componentName: string;
  readonly occurrenceStart: number;
  readonly pathEvidence: PreviewInspectorDirectRoutePathEvidence;
  readonly pattern: string;
  readonly reference?: PreviewInspectorDirectRoutePathComponentReference;
  readonly sourcePath: string;
}): string {
  return JSON.stringify({
    componentExportName: input.reference?.exportName,
    componentName: input.componentName,
    componentSourcePath:
      input.reference === undefined ? undefined : path.normalize(input.reference.sourcePath),
    occurrenceStart: input.occurrenceStart,
    ownerSourcePath: path.normalize(input.sourcePath),
    pathEvidence:
      input.pathEvidence.kind === 'literal' || input.pathEvidence.kind === 'unresolved'
        ? { kind: input.pathEvidence.kind }
        : input.pathEvidence.kind === 'component-base'
          ? {
              exportName: input.pathEvidence.reference.exportName,
              kind: input.pathEvidence.kind,
              prefix: input.pathEvidence.reference.prefix,
              sourcePath: path.normalize(input.pathEvidence.reference.sourcePath),
              suffix: input.pathEvidence.reference.suffix,
            }
          : {
              catalogKey: input.pathEvidence.reference.catalogKey,
              kind: input.pathEvidence.kind,
              normalizerChain: input.pathEvidence.reference.normalizerChain,
              registryExportName: input.pathEvidence.reference.registryExportName,
              registrySourcePath: path.normalize(input.pathEvidence.reference.registrySourcePath),
            },
    pattern: input.pattern,
  });
}

/** Removes only inert TypeScript expression wrappers. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
