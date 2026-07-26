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

/** Resolved runtime module for one route-catalog component identity. */
export interface PreviewInspectorRouteChoiceReference {
  /** Public ESM name requested by the factory module. */
  readonly exportName: string;
  /** Authored source resolved through the package-aware module resolver. */
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
  /** Imported module reference keyed by an exact factory choice occurrence. */
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
  /** Optional project resolver; absent resolution simply omits component module metadata. */
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
 * Import references are resolved in the same syntax pass, but computed/lazy values intentionally
 * remain name-only choices. This is sufficient for path selection while preserving safe pruning.
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
  const factories = collectPreviewInspectorRouteFactoryEvidence(sourceFile).filter(
    (factory) =>
      factory.componentName !== undefined && options.targetIdentities.has(factory.componentName),
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
            exportName: ownerFactory.componentName,
            hasWildcardFallback: ownerFactory.hasWildcardFallback,
            routeSlotCount: ownerFactory.routeSlots.length,
            sourcePath: path.normalize(options.sourcePath),
          }),
        }),
    references: collectRouteFactoryChoiceReferences(options, sourceFile, choices),
  });
}

/**
 * Resolves importer-local page bindings so broad route pruning retains every selectable view.
 *
 * The mapping follows import declarations only. It does not inspect factory implementations or
 * evaluate lazy expressions, and therefore fails open when a page value is computed dynamically.
 */
function collectRouteFactoryChoiceReferences(
  options: CollectPreviewInspectorRouteFactoryChoicesOptions,
  sourceFile: ts.SourceFile,
  choices: readonly PreviewInspectorRouteFactoryChoiceEvidence[],
): ReadonlyMap<string, PreviewInspectorRouteChoiceReference> {
  if (options.resolveModule === undefined) return new Map();
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
  const references = new Map<string, PreviewInspectorRouteChoiceReference>();
  for (const choice of choices) {
    if (choice.localName === undefined) continue;
    const imported = importByLocalName.get(choice.localName);
    if (imported === undefined) continue;
    const resolved = options.resolveModule(imported.moduleSpecifier, options.sourcePath);
    if (resolved === undefined) continue;
    const reference = Object.freeze({
      exportName: imported.exportName,
      sourcePath: path.normalize(resolved),
    });
    references.set(createPreviewInspectorRouteFactoryChoiceKey(choice), reference);
    /* A name key keeps existing consumers compatible; exact occurrence keys remain authoritative. */
    if (!references.has(choice.componentName)) references.set(choice.componentName, reference);
  }
  return references;
}
