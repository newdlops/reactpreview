/** Coordinates bounded prop inference for exported components and individual function parameters. */
import ts from 'typescript';
import { readPreviewAnalysisSourceFile } from '../previewAnalysisSourceFile';
import { inferReactOverlayStateVisibility } from './reactOverlayVisibilityInference';
import { collectIdentityCollectionHelperParameters } from './reactPropInferenceCollections';
import {
  collectExportedComponentFunctions,
  collectLocalComponentDeclarations,
  collectLocalObjectTypes,
  resolveLocalComponent,
} from './reactPropInferenceComponents';
import {
  type InferenceState,
  MAX_COMPONENT_EXPORTS,
  MAX_INFERRED_NODES,
  type PreviewChildPropDemandCatalog,
  type PreviewChildPropDemandSource,
  type PreviewInferredExportProps,
  type PreviewInferredPropsByExport,
  type PreviewInferredPropShape,
  type PreviewPropInferenceOptions,
} from './reactPropInferenceModel';
import { collectStaticRegistryDiscriminantHints } from './reactPropInferenceRegistry';
import { createMutableNode, freezeInference } from './reactPropInferenceShape';
import { hasParseDiagnostics, readScriptKind } from './reactPropInferenceSyntax';
import { collectResolvableObjectTypes } from './reactPropInferenceTypeResolution';
import {
  collectGraphqlDocumentTypeNames,
  collectGraphqlFragmentUnmaskBindings,
} from './reactPropInferenceTypeShape';
import { inferComponentProps, inferFunctionBindingRequirement } from './reactPropInferenceUsage';

/**
 * Collects automatic prop recipes for direct exported component functions.
 *
 * Required same-file types contribute neutral leaves. Runtime usage contributes only receiver
 * containers and operation-proven kinds; an unknown final property is not invented. Existing
 * parent/setup props later overlay this lowest-priority shape in the browser runtime.
 *
 * @param sourcePath Selected JS/TS source path used only to choose parser grammar.
 * @param sourceText Current editor snapshot analyzed without module resolution.
 * @returns Deterministic export-name recipes, or an empty record after parser/budget ambiguity.
 */
export function collectReactExportPropInference(
  sourcePath: string,
  sourceText: string,
  options: PreviewPropInferenceOptions = {},
): PreviewInferredPropsByExport {
  const sourceFile = readPreviewAnalysisSourceFile(
    sourcePath,
    sourceText,
    readScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return {};
  }
  const components = collectExportedComponentFunctions(sourceFile)
    .slice(0, MAX_COMPONENT_EXPORTS)
    .filter(
      (component) =>
        component.classComponentProps === true || component.functionLike.parameters.length > 0,
    );
  // inferComponentProps cannot infer a parameterless function. Avoid reading its type imports or
  // descendant JSX first; class render methods retain their separate this.props contract.
  if (components.length === 0) return Object.freeze({});
  const childPropDemands = memoizeChildPropDemands(options.childPropDemands);
  const localTypes = collectResolvableObjectTypes(sourceFile, sourcePath, options);
  const localComponents = collectLocalComponentDeclarations(sourceFile);
  const identityCollectionHelperParameters = collectIdentityCollectionHelperParameters(sourceFile);
  const registryDiscriminantHints = collectStaticRegistryDiscriminantHints(
    sourceFile,
    sourcePath,
    options,
  );
  const results: Record<string, PreviewInferredExportProps> = {};
  for (const component of components) {
    const inference = inferComponentProps(
      component,
      localTypes,
      sourceFile,
      localComponents,
      0,
      new Set([component.exportName]),
      false,
      childPropDemands,
      registryDiscriminantHints,
      identityCollectionHelperParameters,
      ts.isMethodDeclaration(component.functionLike)
        ? undefined
        : inferReactOverlayStateVisibility(
            component.functionLike,
            component.exportName,
            sourcePath,
            options.resolveImport,
          ),
    );
    if (inference !== undefined && inference.provenance.length > 0) {
      results[component.exportName] = inference;
    }
  }
  return Object.freeze(results);
}

/**
 * Collects prop recipes for exact same-file component bindings reached as JSX children.
 *
 * Render-prop data commonly crosses a local component boundary before its first collection or
 * scalar operation. Keeping this API name-bound and caller-bounded lets GraphQL/hook inference
 * carry that proven demand back without treating every private helper as a public preview export.
 */
export function collectReactLocalComponentPropInference(
  sourcePath: string,
  sourceText: string,
  componentNames: readonly string[],
  options: PreviewPropInferenceOptions = {},
): PreviewInferredPropsByExport {
  if (componentNames.length === 0) return {};
  const sourceFile = readPreviewAnalysisSourceFile(
    sourcePath,
    sourceText,
    readScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return {};
  const childPropDemands = memoizeChildPropDemands(options.childPropDemands);
  const localTypes = collectResolvableObjectTypes(sourceFile, sourcePath, options);
  const declarations = collectLocalComponentDeclarations(sourceFile);
  const identityCollectionHelperParameters = collectIdentityCollectionHelperParameters(sourceFile);
  const registryDiscriminantHints = collectStaticRegistryDiscriminantHints(
    sourceFile,
    sourcePath,
    options,
  );
  const results: Record<string, PreviewInferredExportProps> = {};
  for (const componentName of [...new Set(componentNames)].slice(0, MAX_COMPONENT_EXPORTS)) {
    if (!/^\p{Lu}/u.test(componentName)) continue;
    const candidate = resolveLocalComponent(componentName, declarations);
    if (candidate === undefined) continue;
    const inference = inferComponentProps(
      { exportName: componentName, ...candidate },
      localTypes,
      sourceFile,
      declarations,
      0,
      new Set([componentName]),
      false,
      childPropDemands,
      registryDiscriminantHints,
      identityCollectionHelperParameters,
      ts.isMethodDeclaration(candidate.functionLike)
        ? undefined
        : inferReactOverlayStateVisibility(
            candidate.functionLike,
            componentName,
            sourcePath,
            options.resolveImport,
          ),
    );
    if (inference !== undefined && inference.provenance.length > 0) {
      results[componentName] = inference;
    }
  }
  return Object.freeze(results);
}

/** Collects the same module-wide child catalog once, only if a proven forwarding edge reads it. */
function memoizeChildPropDemands(
  source: PreviewChildPropDemandSource | undefined,
): PreviewChildPropDemandSource | undefined {
  if (typeof source !== 'function') return source;
  let catalog: PreviewChildPropDemandCatalog | undefined;
  return () => (catalog ??= source());
}

/**
 * Infers one runtime function parameter from its bounded, syntax-only property usage.
 * Imported collection callbacks are often intentionally untyped JavaScript helpers; this exposes
 * the same usage inference used for component props without evaluating the imported module.
 */
export function inferReactFunctionParameterUsageShape(
  functionLike: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
  parameterIndex: number,
): PreviewInferredPropShape | undefined {
  if (!Number.isSafeInteger(parameterIndex) || parameterIndex < 0 || parameterIndex > 15) {
    return undefined;
  }
  const parameter = functionLike.parameters[parameterIndex];
  if (parameter === undefined || parameter.dotDotDotToken !== undefined) return undefined;
  const parentState: InferenceState = {
    activeLocalComponentNames: new Set(),
    allowRenderedRootScalar: false,
    aliases: new Map(),
    childPropDemands: undefined,
    collectionDemandDepth: 0,
    functionLike,
    graphqlFragmentUnmaskBindings: collectGraphqlFragmentUnmaskBindings(
      functionLike.getSourceFile(),
    ),
    graphqlDocumentTypeNames: collectGraphqlDocumentTypeNames(functionLike.getSourceFile()),
    identityCollectionHelperParameters: collectIdentityCollectionHelperParameters(
      functionLike.getSourceFile(),
    ),
    localComponents: collectLocalComponentDeclarations(functionLike.getSourceFile()),
    localComponentDemandDepth: 0,
    localTypes: collectLocalObjectTypes(functionLike.getSourceFile()),
    nodeLimit: MAX_INFERRED_NODES,
    nodeCount: 1,
    registryDiscriminantHints: collectStaticRegistryDiscriminantHints(
      functionLike.getSourceFile(),
      functionLike.getSourceFile().fileName,
      {},
    ),
    root: createMutableNode('object', 'usage'),
    sourceFile: functionLike.getSourceFile(),
  };
  const requirement = inferFunctionBindingRequirement(functionLike, parameter.name, parentState);
  return requirement === undefined ? undefined : freezeInference(requirement).shape;
}
export type {
  PreviewChildPropDemandCatalog,
  PreviewInferredExportProps,
  PreviewInferredPropKind,
  PreviewInferredPropProvenance,
  PreviewInferredPropsByExport,
  PreviewInferredPropShape,
  PreviewPropInferenceOptions,
} from './reactPropInferenceModel';
