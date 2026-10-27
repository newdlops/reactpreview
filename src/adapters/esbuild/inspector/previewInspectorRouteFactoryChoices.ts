/**
 * Connects a selected route-factory export to its inert page-map and imported component modules.
 *
 * Route syntax collection owns path discovery; this module owns only the factory's mutually
 * exclusive choices and ESM references. Separating those responsibilities keeps the main analyzer
 * bounded while allowing the corridor plugin to retain selectable pages in broad eager registries.
 */
import path from 'node:path';
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import {
  collectPreviewInspectorRouteFactoryEvidence,
  type PreviewInspectorRouteFactoryChoiceEvidence,
  type PreviewInspectorRouteFactoryEvidence,
} from './previewInspectorRouteFactory';
import {
  collectPreviewInspectorRouteFactoryLocalExports,
  type PreviewInspectorRouteFactoryLocalExport,
} from './previewInspectorRouteFactoryLocalExports';

/** Resolved runtime module for one route-catalog component identity. */
export interface PreviewInspectorRouteChoiceReference {
  /** Public ESM name requested by the factory module. */
  readonly exportName: string;
  /** Exact outer-to-inner component wrappers retained by a static factory composition call. */
  readonly elementWrappers?: readonly PreviewInspectorRouteChoiceWrapperReference[];
  /** Authored source resolved through the package-aware module resolver. */
  readonly sourcePath: string;
}

/** One resolved component argument composed around a factory page choice. */
export interface PreviewInspectorRouteChoiceWrapperReference {
  readonly componentName: string;
  readonly exportName: string;
  readonly sourcePath: string;
}

/** Route-owner metadata retained without importing or evaluating the generated application. */
export interface PreviewInspectorRouteFactoryOwnerEvidence {
  /** Absolute module mount path proven by the factory's first argument. */
  readonly basePath: string;
  /** Selected factory export that owns this route collection. */
  readonly exportName: string;
  /** Whether the wrapper exposes a literal wildcard fallback below its route slots. */
  readonly hasWildcardFallback: boolean;
  /** Number of statically proven variable Route slots in the wrapper callback. */
  readonly routeSlotCount: number;
  /** Source module containing the selected factory call. */
  readonly sourcePath: string;
}

/** Immutable factory choices plus references available without executing project code. */
export interface PreviewInspectorRouteFactoryChoiceInventory {
  /** Page-map keys and submodule values owned by the selected factory export. */
  readonly choices: readonly PreviewInspectorRouteFactoryChoiceEvidence[];
  /** Selected factory's inert mount contract, when one was statically proven. */
  readonly owner?: PreviewInspectorRouteFactoryOwnerEvidence;
  /** Exact imported or public same-file runtime reference keyed by a factory choice occurrence. */
  readonly references: ReadonlyMap<string, PreviewInspectorRouteChoiceReference>;
}

/** Prevents duplicate component values in different route slots from overwriting each other. */
export function createPreviewInspectorRouteFactoryChoiceKey(
  choice: PreviewInspectorRouteFactoryChoiceEvidence,
): string {
  return [choice.kind, choice.componentName, String(choice.occurrenceStart)].join('\0');
}

/** Inputs remain parser-only and accept the caller's package-aware resolver as a capability. */
export interface CollectPreviewInspectorRouteFactoryChoicesOptions {
  /** Optional import resolver; public same-file exports do not require an external resolution. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Selected route-factory source identity. */
  readonly sourcePath: string;
  /** Current editor/disk snapshot, when available. */
  readonly sourceText: string | undefined;
  /** Exact aliases that can denote the selected export in this source. */
  readonly targetIdentities: ReadonlySet<string>;
}

/**
 * Reads page/submodule names only from the factory that directly owns the selected export.
 *
 * Public local exports and import references are resolved in the same syntax pass; computed/lazy
 * values remain name-only choices. Exact identities preserve path selection and safe pruning.
 */
export function collectPreviewInspectorRouteFactoryChoices(
  options: CollectPreviewInspectorRouteFactoryChoicesOptions,
): PreviewInspectorRouteFactoryChoiceInventory {
  if (options.sourceText === undefined) {
    return Object.freeze({ choices: Object.freeze([]), references: new Map() });
  }
  const sourceFile = ts.createSourceFile(
    options.sourcePath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    options.sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const localExports = collectPreviewInspectorRouteFactoryLocalExports(sourceFile);
  const targetIdentities = new Set(options.targetIdentities);
  for (const identity of options.targetIdentities) {
    const local = localExports.get(identity);
    if (local !== undefined) targetIdentities.add(local.localName);
  }
  const factories = collectPreviewInspectorRouteFactoryEvidence(sourceFile).filter(
    (factory) => factory.componentName !== undefined && targetIdentities.has(factory.componentName),
  );
  const choices = Object.freeze(factories.flatMap((factory) => factory.choices));
  const ownerFactory = factories.find(
    (
      factory,
    ): factory is PreviewInspectorRouteFactoryEvidence & { readonly componentName: string } =>
      factory.componentName !== undefined,
  );
  return Object.freeze({
    choices,
    ...(ownerFactory === undefined
      ? {}
      : {
          owner: Object.freeze({
            basePath: ownerFactory.basePath,
            exportName:
              [...options.targetIdentities].find(
                (identity) =>
                  identity === ownerFactory.componentName ||
                  localExports.get(identity)?.localName === ownerFactory.componentName,
              ) ?? ownerFactory.componentName,
            hasWildcardFallback: ownerFactory.hasWildcardFallback,
            routeSlotCount: ownerFactory.routeSlots.length,
            sourcePath: path.normalize(options.sourcePath),
          }),
        }),
    references: collectRouteFactoryChoiceReferences(options, sourceFile, choices, localExports),
  });
}

/**
 * Resolves importer-local page bindings so broad route pruning retains every selectable view.
 *
 * Import declarations and explicit same-file runtime exports provide exact module identities.
 * Initializers and factory implementations are never evaluated. Private, type-only, ambiguous or
 * not-yet-initialized local values remain unresolved instead of inventing an importable export.
 */
function collectRouteFactoryChoiceReferences(
  options: CollectPreviewInspectorRouteFactoryChoicesOptions,
  sourceFile: ts.SourceFile,
  choices: readonly PreviewInspectorRouteFactoryChoiceEvidence[],
  localExports: ReadonlyMap<string, PreviewInspectorRouteFactoryLocalExport>,
): ReadonlyMap<string, PreviewInspectorRouteChoiceReference> {
  const importByLocalName = new Map<
    string,
    { readonly exportName: string; readonly moduleSpecifier: string }
  >();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause?.name !== undefined) {
      importByLocalName.set(clause.name.text, { exportName: 'default', moduleSpecifier });
    }
    const bindings = clause?.namedBindings;
    if (bindings === undefined || ts.isNamespaceImport(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      importByLocalName.set(element.name.text, {
        exportName: (element.propertyName ?? element.name).text,
        moduleSpecifier,
      });
    }
  }
  const publicByLocalName = new Map<
    string,
    { readonly exportName: string; readonly availableAfter: number }
  >();
  for (const [exportName, binding] of localExports) {
    if (!publicByLocalName.has(binding.localName) || exportName === binding.localName) {
      publicByLocalName.set(binding.localName, {
        exportName,
        availableAfter: binding.availableAfter,
      });
    }
  }
  const references = new Map<string, PreviewInspectorRouteChoiceReference>();
  for (const choice of choices) {
    if (choice.localName === undefined) continue;
    const resolvedChoice = resolveRuntimeBinding(choice.localName, choice.occurrenceStart);
    if (resolvedChoice === undefined) continue;
    const elementWrappers = (choice.wrapperLocalNames ?? []).flatMap((localName) => {
      const resolvedWrapper = resolveRuntimeBinding(localName, choice.occurrenceStart);
      return resolvedWrapper === undefined
        ? []
        : [
            Object.freeze({
              componentName: localName,
              exportName: resolvedWrapper.exportName,
              sourcePath: resolvedWrapper.sourcePath,
            }),
          ];
    });
    const reference = Object.freeze({
      exportName: resolvedChoice.exportName,
      ...(elementWrappers.length === 0 ? {} : { elementWrappers: Object.freeze(elementWrappers) }),
      sourcePath: resolvedChoice.sourcePath,
    });
    references.set(createPreviewInspectorRouteFactoryChoiceKey(choice), reference);
  }
  return references;

  /** Resolves one exact import or public local binding available at this factory use site. */
  function resolveRuntimeBinding(
    localName: string,
    before: number,
  ): { readonly exportName: string; readonly sourcePath: string } | undefined {
    const imported = importByLocalName.get(localName);
    if (imported === undefined) {
      const local = publicByLocalName.get(localName);
      return local === undefined || local.availableAfter >= before
        ? undefined
        : Object.freeze({
            exportName: local.exportName,
            sourcePath: path.normalize(options.sourcePath),
          });
    }
    const resolved = options.resolveModule?.(imported.moduleSpecifier, options.sourcePath);
    return resolved === undefined
      ? undefined
      : Object.freeze({
          exportName: imported.exportName,
          sourcePath: path.normalize(resolved),
        });
  }
}
