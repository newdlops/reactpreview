/** Propagates syntax-proven component and collection demands through local calls and JSX. */
import ts from 'typescript';
import {
  collectPreviewRuntimeLocalHelperArgumentDemands,
  collectPreviewRuntimeLocalHelperParameterDemands,
} from './previewRuntimeHookLocalHelperItem';
import { type ReactOverlayStateVisibilityValue } from './reactOverlayVisibilityInference';
import { annotatePreviewPropCollections } from './reactPropCollectionType';
import {
  collectBoundedIndexReadLengths,
  collectKeyedCollectionHelperRequirements,
  readIdentityCollectionHelperCallPath,
} from './reactPropInferenceCollections';
import { resolveLocalComponent } from './reactPropInferenceComponents';
import {
  collectEqualityDiscriminantRequirements,
  collectSwitchDiscriminantRequirements,
} from './reactPropInferenceDiscriminants';
import {
  ARRAY_ITEM_CALLBACK_METHOD_NAMES,
  ARRAY_ITEM_CALLBACK_PARAMETER_INDEX,
  ARRAY_ITEM_IDENTITY_METHOD_NAMES,
  BLOCKED_PROPERTY_NAMES,
  CLASS_COMPONENT_PROPS_ALIAS,
  type ExportedComponentFunction,
  type ExportedFunctionLike,
  type InferenceState,
  type LocalComponentDeclaration,
  type LocalObjectType,
  MAX_INFERRED_DEPTH,
  MAX_INFERRED_NODES,
  MIN_USAGE_NODE_RESERVE,
  type MutableShapeNode,
  type PreviewChildPropDemandCatalog,
  type PreviewChildPropDemandSource,
  type PreviewInferredExportProps,
  type PreviewStaticRegistryKey,
  type PropPathBinding,
  RENDERED_COLLECTION_CALLBACK_NAMES,
  RENDERED_COLLECTION_CONFIG_PROP_NAMES,
  RENDERED_COLLECTION_FIELD_KEY_NAMES,
  RENDERED_COLLECTION_ITEM_WRAPPER_NAMES,
  RENDERED_COLLECTION_PROP_NAMES,
} from './reactPropInferenceModel';
import {
  addOperationRequirement,
  addReceiverContainers,
  applyMaterializedOptionalOperations,
  inferPreviewUsageSemanticFallback,
  readEmptyCollectionDefaultPropPath,
  readFirstOptionalReceiverLength,
} from './reactPropInferenceOperations';
import {
  createMutableNode,
  freezeInference,
  mergeFrozenShapeAtPath,
  mergeMutableShapeAtPath,
  mergeMutableShapeRequirement,
  readMutablePathNode,
  readPreviewInferredExactValue,
  requirePath,
} from './reactPropInferenceShape';
import {
  isAccessExpression,
  isDeclarationName,
  isIdentifierPartOfAccess,
  isInsideNestedFunction,
  isNestedAccessReceiver,
  isShadowedIdentifier,
  isShadowedPathRoot,
  readBindingPropertyName,
  readLiteralValue,
  readPropertyName,
  readPropPath,
  unwrapExpression,
} from './reactPropInferenceSyntax';
import {
  addOverlayVisibilityRequirement,
  collectParameterBindings,
  collectRequiredPropertyReadTerminals,
  collectTemplateTextReads,
  labelDirectlyRenderedChildren,
  markDirectlyRenderedTextProps,
} from './reactPropInferenceText';
import {
  addTypedParameterRequirements,
  addTypeRequirement,
  collectGraphqlDocumentTypeNames,
  collectGraphqlFragmentUnmaskBindings,
  readObjectTypeMembers,
  setArrayItemRequirement,
} from './reactPropInferenceTypeShape';

/** Infers local type and direct-use requirements for one component function. */
export function inferComponentProps(
  component: ExportedComponentFunction,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  sourceFile: ts.SourceFile,
  localComponents: ReadonlyMap<string, LocalComponentDeclaration>,
  localComponentDemandDepth = 0,
  activeLocalComponentNames: ReadonlySet<string> = new Set([component.exportName]),
  followLocalJsxPropForwarding = false,
  childPropDemands?: PreviewChildPropDemandSource,
  registryDiscriminantHints: ReadonlyMap<string, PreviewStaticRegistryKey> = new Map(),
  identityCollectionHelperParameters: ReadonlyMap<string, ReadonlySet<number>> = new Map(),
  overlayStateVisibility?: ReactOverlayStateVisibilityValue,
): PreviewInferredExportProps | undefined {
  const { functionLike } = component;
  const parameter = functionLike.parameters[0];
  if (parameter === undefined && component.classComponentProps !== true) {
    return undefined;
  }
  const root = createMutableNode('object', 'usage');
  const state: InferenceState = {
    activeLocalComponentNames,
    allowRenderedRootScalar: false,
    aliases: new Map(),
    childPropDemands,
    collectionDemandDepth: 0,
    functionLike,
    graphqlFragmentUnmaskBindings: collectGraphqlFragmentUnmaskBindings(sourceFile),
    graphqlDocumentTypeNames: collectGraphqlDocumentTypeNames(sourceFile),
    identityCollectionHelperParameters,
    localComponents,
    localComponentDemandDepth,
    localTypes,
    nodeLimit: MAX_INFERRED_NODES,
    nodeCount: 1,
    registryDiscriminantHints,
    root,
    sourceFile,
  };
  if (component.classComponentProps === true) {
    state.aliases.set(CLASS_COMPONENT_PROPS_ALIAS, { path: [] });
  }
  if (parameter !== undefined) {
    collectParameterBindings(parameter.name, [], state.aliases);
    state.nodeLimit = MAX_INFERRED_NODES - MIN_USAGE_NODE_RESERVE;
    try {
      addTypedParameterRequirements(
        parameter,
        component.contextualPropsType,
        localTypes,
        state,
        sourceFile,
      );
    } finally {
      state.nodeLimit = MAX_INFERRED_NODES;
    }
  }
  collectLocalPropAliases(functionLike, state);
  collectLocalHelperForwardedPropRequirements(functionLike, state);
  collectKeyedCollectionHelperRequirements(functionLike, state);
  collectUsageRequirements(functionLike, state);
  collectBoundedIndexReadLengths(functionLike, state);
  collectRenderedCollectionRequirements(functionLike, state);
  collectEqualityDiscriminantRequirements(functionLike, state);
  collectSwitchDiscriminantRequirements(functionLike, state);
  collectCatalogJsxForwardedPropRequirements(functionLike, state);
  if (followLocalJsxPropForwarding) {
    collectLocalJsxForwardedPropRequirements(functionLike, state);
  }
  collectTemplateTextReads(functionLike, state);
  addOverlayVisibilityRequirement(component, localTypes, state, sourceFile, overlayStateVisibility);
  applyMaterializedOptionalOperations(state);
  const propsType = parameter?.type ?? component.contextualPropsType;
  const propsMembers =
    propsType === undefined ? undefined : readObjectTypeMembers(propsType, localTypes, new Set());
  if (propsMembers !== undefined)
    annotatePreviewPropCollections(state.root, propsMembers, sourceFile);
  labelDirectlyRenderedChildren(component, state);
  markDirectlyRenderedTextProps(component.functionLike, state);
  if (state.root.children.size === 0) {
    return undefined;
  }
  return freezeInference(state.root);
}

/**
 * Carries a prop identity through an unambiguous same-file helper call.
 *
 * Components often keep render-only collection access in helpers such as
 * `createOptions(project)` or `renderUser(project)`. Direct component scanning can prove only that
 * `project` is an object in those cases. The shared helper graph follows the unchanged identifier
 * into one uniquely declared local function; that helper's ordinary usage inference then supplies
 * the missing nested Array/item contract without resolving imports or executing application code.
 */
export function collectLocalHelperForwardedPropRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  if (ts.isMethodDeclaration(functionLike)) return;
  for (const demand of collectPreviewRuntimeLocalHelperArgumentDemands(
    functionLike,
    state.sourceFile,
  )) {
    const argumentPath = readPropPath(demand.argument, state.aliases);
    if (argumentPath === undefined || argumentPath.length > MAX_INFERRED_DEPTH) continue;
    const requirement = inferFunctionBindingRequirement(demand.owner, demand.parameter.name, state);
    if (requirement !== undefined) {
      mergeMutableShapeAtPath(state.root, argumentPath, requirement, state);
    }
  }
  for (const [aliasName, binding] of state.aliases) {
    for (const demand of collectPreviewRuntimeLocalHelperParameterDemands(
      functionLike,
      aliasName,
      state.sourceFile,
    )) {
      const requirement = inferFunctionBindingRequirement(
        demand.owner,
        demand.parameter.name,
        state,
      );
      if (requirement !== undefined) {
        mergeMutableShapeAtPath(state.root, binding.path, requirement, state);
      }
    }
  }
}

/** Collects simple local aliases before evaluating later receiver paths in callbacks and JSX. */
export function collectLocalPropAliases(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const sourcePath =
        readPropPath(node.initializer, state.aliases) ??
        readEmptyCollectionDefaultPropPath(node.initializer, state.aliases) ??
        readIdentityCollectionHelperCallPath(node.initializer, state) ??
        readGraphqlFragmentUnmaskCallPath(node.initializer, state);
      if (sourcePath !== undefined) {
        if (ts.isIdentifier(node.name)) {
          state.aliases.set(node.name.text, { path: sourcePath });
        } else if (ts.isObjectBindingPattern(node.name)) {
          /* Object binding throws for a nullish receiver even when every bound leaf is only
           * forwarded opaquely. Retain the prop-derived container before mapping its aliases so a
           * direct preview can execute chains such as `const { ir: irInfo } = object` followed by
           * another destructure or child-prop forwarding. */
          if (!isInsideNestedFunction(node, state.functionLike)) {
            requirePath(state, sourcePath, 'object', 'usage');
          }
          for (const element of node.name.elements) {
            const propertyName = readBindingPropertyName(element);
            if (
              propertyName !== undefined &&
              !BLOCKED_PROPERTY_NAMES.has(propertyName) &&
              ts.isIdentifier(element.name)
            ) {
              state.aliases.set(element.name.text, { path: [...sourcePath, propertyName] });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/**
 * Carries a generated GraphQL fragment value through the canonical masking helper.
 *
 * `getFragmentData(document, value)` is a compile-time masking boundary whose runtime result is
 * the same response object. Accept only its direct imported binding and second argument so an
 * unrelated two-argument helper can never be treated as an identity transform.
 */
export function readGraphqlFragmentUnmaskCallPath(
  expression: ts.Expression,
  state: InferenceState,
): readonly string[] | undefined {
  const current = unwrapExpression(expression);
  if (
    !ts.isCallExpression(current) ||
    !ts.isIdentifier(current.expression) ||
    !state.graphqlFragmentUnmaskBindings.has(current.expression.text) ||
    current.arguments.length < 2
  ) {
    return undefined;
  }
  const value = current.arguments[1];
  if (value === undefined || ts.isSpreadElement(value)) return undefined;
  return readPropPath(value, state.aliases);
}

/** Derives receiver containers and operation kinds from property paths rooted in known props. */
export function collectUsageRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const collectReceivers = (node: ts.Node): void => {
    if (isAccessExpression(node) && !isNestedAccessReceiver(node)) {
      const path_ = readPropPath(node, state.aliases);
      if (path_ !== undefined && path_.length > 0 && !isShadowedPathRoot(node, state)) {
        const optionalReceiverLength = readFirstOptionalReceiverLength(node, state.aliases);
        addReceiverContainers(state, path_, optionalReceiverLength ?? path_.length);
      }
    }
    ts.forEachChild(node, collectReceivers);
  };
  const collectOperations = (node: ts.Node): void => {
    if (isAccessExpression(node) && !isNestedAccessReceiver(node)) {
      const path_ = readPropPath(node, state.aliases);
      if (path_ !== undefined && path_.length > 0 && !isShadowedPathRoot(node, state)) {
        const optionalReceiverLength = readFirstOptionalReceiverLength(node, state.aliases);
        if (optionalReceiverLength === undefined) addOperationRequirement(state, path_, node);
        else
          (state.optionalOperations ??= []).push({
            node,
            path: path_,
            receiverLength: optionalReceiverLength,
          });
      }
    } else if (ts.isIdentifier(node)) {
      const binding = state.aliases.get(node.text);
      if (
        binding !== undefined &&
        binding.path.length > 0 &&
        !isIdentifierPartOfAccess(node) &&
        !isDeclarationName(node) &&
        !isShadowedIdentifier(node, node.text, state.functionLike)
      ) {
        addOperationRequirement(state, binding.path, node);
      }
    }
    ts.forEachChild(node, collectOperations);
  };
  collectReceivers(body);
  collectOperations(body);
  collectArrayCallbackItemRequirements(body, state);
}

/** Carries collection-callback field demand into the owning prop Array's generated item shape. */
export function collectArrayCallbackItemRequirements(
  body: ts.ConciseBody,
  state: InferenceState,
): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.questionDotToken === undefined &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.questionDotToken === undefined &&
      ARRAY_ITEM_CALLBACK_METHOD_NAMES.has(node.expression.name.text)
    ) {
      const receiver = readCollectionCarrierPropPath(node.expression.expression, state.aliases);
      const callbackArgument = node.arguments[0];
      const callback =
        callbackArgument === undefined || ts.isSpreadElement(callbackArgument)
          ? undefined
          : unwrapExpression(callbackArgument);
      if (
        receiver !== undefined &&
        !isShadowedPathRoot(receiver.expression, state) &&
        callback !== undefined &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ) {
        requirePath(state, receiver.path, 'array', 'usage');
        setArrayItemRequirement(
          state,
          receiver.path,
          inferArrayCallbackItemRequirement(
            callback,
            state,
            ARRAY_ITEM_CALLBACK_PARAMETER_INDEX.get(node.expression.name.text) ?? 0,
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Reads a prop collection through bounded transforms that preserve every item's identity. */
export function readCollectionCarrierPropPath(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, PropPathBinding>,
): Readonly<{ expression: ts.Expression; path: readonly string[] }> | undefined {
  let current = unwrapExpression(expression);
  for (let depth = 0; ts.isCallExpression(current) && depth < 8; depth += 1) {
    if (current.questionDotToken !== undefined) return undefined;
    const callee = unwrapExpression(current.expression);
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.questionDotToken !== undefined ||
      !ARRAY_ITEM_IDENTITY_METHOD_NAMES.has(callee.name.text)
    ) {
      return undefined;
    }
    current = unwrapExpression(callee.expression);
  }
  const path_ = readPropPath(current, aliases);
  return path_ === undefined ? undefined : { expression: current, path: path_ };
}

/**
 * Correlates a prop-fed list/table data attribute with its sibling column callback contracts.
 *
 * Package tables are often opaque to the source walker: the row Array enters through `dataList`
 * while its real field reads live inside `columns`. This exact JSX relationship proves both that
 * the collection must contain rows and which finite discriminator values make those rows visible.
 */
export function collectRenderedCollectionRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties;
      const collectionAttributes = attributes.flatMap((attribute) => {
        if (
          !ts.isJsxAttribute(attribute) ||
          !ts.isIdentifier(attribute.name) ||
          attribute.initializer === undefined ||
          !ts.isJsxExpression(attribute.initializer) ||
          attribute.initializer.expression === undefined ||
          !RENDERED_COLLECTION_PROP_NAMES.has(attribute.name.text.toLowerCase())
        ) {
          return [];
        }
        const collection = readRenderedCollectionCarrierPropPath(
          attribute.initializer.expression,
          state,
        );
        return collection === undefined || isShadowedPathRoot(collection.expression, state)
          ? []
          : [collection];
      });
      if (collectionAttributes.length === 1) {
        const collection = collectionAttributes[0];
        if (collection !== undefined) {
          const item = inferRenderedCollectionConfigurationItem(attributes, state);
          if (item !== undefined) {
            requirePath(state, collection.path, 'array', 'usage');
            setArrayItemRequirement(state, collection.path, item);
            const collectionNode = readMutablePathNode(state, collection.path);
            if (collectionNode?.kind === 'array') collectionNode.renderedCollection = true;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Reads only direct Array transforms that retain every original item field. */
export function readRenderedCollectionCarrierPropPath(
  expression: ts.Expression,
  state: InferenceState,
): Readonly<{ expression: ts.Expression; path: readonly string[] }> | undefined {
  let current = unwrapExpression(expression);
  for (let depth = 0; ts.isCallExpression(current) && depth < 8; depth += 1) {
    if (current.questionDotToken !== undefined) return undefined;
    const callee = unwrapExpression(current.expression);
    if (!ts.isPropertyAccessExpression(callee) || callee.questionDotToken !== undefined) {
      return undefined;
    }
    if (ARRAY_ITEM_IDENTITY_METHOD_NAMES.has(callee.name.text)) {
      current = unwrapExpression(callee.expression);
      continue;
    }
    if (
      callee.name.text === 'map' &&
      isRenderedCollectionIdentityMapCallback(current.arguments[0])
    ) {
      current = unwrapExpression(callee.expression);
      continue;
    }
    return undefined;
  }
  const path_ = readPropPath(current, state.aliases);
  return path_ === undefined ? undefined : { expression: current, path: path_ };
}

/** Accepts a map only when its returned record explicitly spreads the unchanged item. */
export function isRenderedCollectionIdentityMapCallback(
  expression: ts.Expression | undefined,
): boolean {
  if (
    expression === undefined ||
    (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression))
  ) {
    return false;
  }
  const parameter = expression.parameters[0];
  if (parameter === undefined || !ts.isIdentifier(parameter.name)) return false;
  const parameterName = parameter.name.text;
  const returned = readRenderedCollectionCallbackReturnExpression(expression);
  if (returned === undefined) return false;
  const value = unwrapExpression(returned);
  if (ts.isIdentifier(value)) return value.text === parameterName;
  return (
    ts.isObjectLiteralExpression(value) &&
    value.properties.some(
      (property) =>
        ts.isSpreadAssignment(property) &&
        ts.isIdentifier(unwrapExpression(property.expression)) &&
        (unwrapExpression(property.expression) as ts.Identifier).text === parameterName,
    )
  );
}

/** Reads an expression body or one unambiguous top-level return from a collection callback. */
export function readRenderedCollectionCallbackReturnExpression(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): ts.Expression | undefined {
  if (!ts.isBlock(callback.body)) return callback.body;
  const returns = callback.body.statements.filter(
    (statement): statement is ts.ReturnStatement =>
      ts.isReturnStatement(statement) && statement.expression !== undefined,
  );
  return returns.length === 1 ? returns[0]?.expression : undefined;
}

/** Builds one row shape from field keys and static callbacks inside sibling table configuration. */
export function inferRenderedCollectionConfigurationItem(
  attributes: ts.NodeArray<ts.JsxAttributeLike>,
  state: InferenceState,
): MutableShapeNode | undefined {
  let item: MutableShapeNode | undefined;
  const mergeItem = (candidate: MutableShapeNode | undefined): void => {
    if (candidate?.kind !== 'object') return;
    if (item === undefined) item = candidate;
    else mergeMutableShapeRequirement(item, candidate);
  };
  const appendField = (fieldName: string): void => {
    if (fieldName.length === 0 || fieldName.length > 128 || BLOCKED_PROPERTY_NAMES.has(fieldName)) {
      return;
    }
    const semantic = inferPreviewUsageSemanticFallback(state, fieldName);
    const field = createMutableNode(semantic?.kind ?? 'string', 'usage');
    if (semantic?.value !== undefined) field.value = semantic.value;
    const row = createMutableNode('object', 'usage');
    row.children.set(fieldName, field);
    mergeItem(row);
  };
  const appendCallback = (callback: ts.ArrowFunction | ts.FunctionExpression): void => {
    const inferred = inferArrayCallbackItemRequirement(callback, state);
    mergeItem(unwrapRenderedCollectionCallbackItem(inferred));
  };
  for (const attribute of attributes) {
    if (
      !ts.isJsxAttribute(attribute) ||
      !ts.isIdentifier(attribute.name) ||
      attribute.initializer === undefined ||
      !ts.isJsxExpression(attribute.initializer) ||
      attribute.initializer.expression === undefined ||
      !RENDERED_COLLECTION_CONFIG_PROP_NAMES.has(attribute.name.text.toLowerCase())
    ) {
      continue;
    }
    const visitConfig = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)) {
        const propertyName = readPropertyName(node.name)?.toLowerCase();
        const initializer = unwrapExpression(node.initializer);
        if (
          propertyName !== undefined &&
          RENDERED_COLLECTION_FIELD_KEY_NAMES.has(propertyName) &&
          ts.isStringLiteralLike(initializer)
        ) {
          appendField(initializer.text);
        }
        if (
          propertyName !== undefined &&
          RENDERED_COLLECTION_CALLBACK_NAMES.has(propertyName) &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          appendCallback(initializer);
          return;
        }
      }
      ts.forEachChild(node, visitConfig);
    };
    visitConfig(attribute.initializer.expression);
  }
  return item;
}

/** Removes conventional table callback wrappers such as `{ data }` from the actual row shape. */
export function unwrapRenderedCollectionCallbackItem(
  requirement: MutableShapeNode | undefined,
): MutableShapeNode | undefined {
  if (requirement?.kind !== 'object') return requirement;
  const wrappers = [...requirement.children.entries()].filter(
    ([name, child]) =>
      RENDERED_COLLECTION_ITEM_WRAPPER_NAMES.has(name.toLowerCase()) && child.kind === 'object',
  );
  return wrappers.length === 1 ? wrappers[0]?.[1] : requirement;
}

/** Infers one callback parameter in isolation, retaining recursively nested collection demand. */
export function inferArrayCallbackItemRequirement(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  parentState: InferenceState,
  itemParameterIndex = 0,
): MutableShapeNode | undefined {
  const parameter = callback.parameters[itemParameterIndex];
  if (
    parameter === undefined ||
    parameter.dotDotDotToken !== undefined ||
    parentState.collectionDemandDepth >= 8
  ) {
    return undefined;
  }
  let combined = inferFunctionBindingRequirement(callback, parameter.name, parentState, true);
  if (ts.isIdentifier(parameter.name)) {
    for (const demand of collectPreviewRuntimeLocalHelperParameterDemands(
      callback,
      parameter.name.text,
      callback.getSourceFile(),
    )) {
      const helper = inferFunctionBindingRequirement(
        demand.owner,
        demand.parameter.name,
        parentState,
        true,
      );
      if (helper === undefined) continue;
      if (combined === undefined) combined = helper;
      else mergeMutableShapeRequirement(combined, helper);
    }
  }
  const forwarded = inferLocalJsxForwardedItemRequirement(callback, parameter.name, parentState);
  if (forwarded !== undefined) {
    if (combined === undefined) combined = forwarded;
    else mergeMutableShapeRequirement(combined, forwarded);
  }
  return combined;
}

/** Carries an array item into the exact prop contract of a local or catalogued JSX child. */
export function inferLocalJsxForwardedItemRequirement(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  binding: ts.BindingName,
  parentState: InferenceState,
): MutableShapeNode | undefined {
  if (parentState.localComponentDemandDepth >= 8) return undefined;
  const aliases = new Map<string, PropPathBinding>();
  collectParameterBindings(binding, [], aliases);
  const aliasState: InferenceState = {
    ...parentState,
    aliases,
    collectionDemandDepth: parentState.collectionDemandDepth + 1,
    functionLike: callback,
    root: createMutableNode('object', 'usage'),
  };
  collectLocalPropAliases(callback, aliasState);
  const root = createMutableNode('object', 'usage');
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression !== undefined
    ) {
      const opening = node.parent.parent;
      const tagName =
        (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) &&
        ts.isIdentifier(opening.tagName)
          ? opening.tagName.text
          : undefined;
      const path_ = readPropPath(node.initializer.expression, aliases);
      const identity = tagName === undefined ? undefined : `${tagName}\0${node.name.text}`;
      if (
        tagName !== undefined &&
        path_ !== undefined &&
        path_.length <= MAX_INFERRED_DEPTH &&
        identity !== undefined &&
        !seen.has(identity)
      ) {
        seen.add(identity);
        const catalogShape = readChildPropDemands(parentState.childPropDemands)
          ?.get(tagName)
          ?.get(node.name.text);
        const candidate = resolveLocalComponent(tagName, parentState.localComponents);
        const activeLocalComponentNames = new Set(parentState.activeLocalComponentNames);
        const recursivelyActive = activeLocalComponentNames.has(tagName);
        activeLocalComponentNames.add(tagName);
        const inference =
          catalogShape !== undefined || candidate === undefined || recursivelyActive
            ? undefined
            : inferComponentProps(
                { exportName: tagName, ...candidate },
                parentState.localTypes,
                parentState.sourceFile,
                parentState.localComponents,
                parentState.localComponentDemandDepth + 1,
                activeLocalComponentNames,
                true,
                parentState.childPropDemands,
                parentState.registryDiscriminantHints,
                parentState.identityCollectionHelperParameters,
              );
        const shape = catalogShape ?? inference?.shape.properties?.[node.name.text];
        if (shape !== undefined) mergeFrozenShapeAtPath(root, path_, shape, parentState);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(callback.body);
  return root.children.size === 0 ? undefined : root;
}

/**
 * Carries an exact imported/local child prop contract back through one JSX identity edge.
 *
 * The catalog is built by a bounded parse-only module walker. This layer accepts only direct
 * identifier attributes such as `company={company}` whose expression is already rooted at the
 * selected component's props; calls, object literals, spreads, and optional carriers remain
 * authored because they do not prove an identity-preserving value relationship.
 */
export function collectCatalogJsxForwardedPropRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const source = state.childPropDemands;
  if (
    source === undefined ||
    (typeof source !== 'function' && source.size === 0) ||
    functionLike.body === undefined
  )
    return;
  let catalog: PreviewChildPropDemandCatalog | undefined;
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression !== undefined &&
      isInsideSelectedPropSwitchClause(node, state)
    ) {
      const opening = node.parent.parent;
      const tagName =
        (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) &&
        ts.isIdentifier(opening.tagName)
          ? opening.tagName.text
          : undefined;
      const expression = node.initializer.expression;
      const path_ = readPropPath(expression, state.aliases);
      if (
        tagName !== undefined &&
        path_ !== undefined &&
        path_.length > 0 &&
        path_.length <= MAX_INFERRED_DEPTH &&
        !isShadowedPathRoot(expression, state)
      ) {
        catalog ??= readChildPropDemands(source);
        const shape = catalog?.get(tagName)?.get(node.name.text);
        const identity = `${tagName}\0${node.name.text}\0${path_.join('.')}`;
        if (shape !== undefined && !seen.has(identity)) {
          seen.add(identity);
          mergeFrozenShapeAtPath(state.root, path_, shape, state);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionLike.body);
}

/** Resolves only compiler-provided child data; callers must first prove a local forwarding edge. */
function readChildPropDemands(
  source: PreviewChildPropDemandSource | undefined,
): PreviewChildPropDemandCatalog | undefined {
  return typeof source === 'function' ? source() : source;
}

/**
 * Carries one prop-derived value through an exact same-file JSX component boundary.
 *
 * A collection item often enters a local switch dispatcher before the selected renderer reads its
 * required fields. Follow only identifier-named local components, only the already selected switch
 * clause, and stop when a component identity recurs. This materializes the first real renderer's
 * contract without recursively inventing an unbounded tree such as Paragraph -> Node -> Paragraph.
 */
export function collectLocalJsxForwardedPropRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  if (state.localComponentDemandDepth >= 8 || functionLike.body === undefined) return;
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression !== undefined &&
      isInsideSelectedPropSwitchClause(node, state)
    ) {
      const opening = node.parent.parent;
      const tagName =
        (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) &&
        ts.isIdentifier(opening.tagName)
          ? opening.tagName.text
          : undefined;
      const expression = node.initializer.expression;
      const path_ = readPropPath(expression, state.aliases);
      const identity =
        tagName === undefined || path_ === undefined
          ? undefined
          : `${tagName}\0${node.name.text}\0${path_.join('.')}`;
      if (
        tagName !== undefined &&
        path_ !== undefined &&
        path_.length > 0 &&
        path_.length <= MAX_INFERRED_DEPTH &&
        identity !== undefined &&
        !seen.has(identity) &&
        !state.activeLocalComponentNames.has(tagName) &&
        !isShadowedPathRoot(expression, state)
      ) {
        seen.add(identity);
        const candidate = resolveLocalComponent(tagName, state.localComponents);
        if (candidate !== undefined) {
          const activeLocalComponentNames = new Set(state.activeLocalComponentNames);
          activeLocalComponentNames.add(tagName);
          const inference = inferComponentProps(
            { exportName: tagName, ...candidate },
            state.localTypes,
            state.sourceFile,
            state.localComponents,
            state.localComponentDemandDepth + 1,
            activeLocalComponentNames,
            true,
            state.childPropDemands,
            state.registryDiscriminantHints,
            state.identityCollectionHelperParameters,
          );
          const shape = inference?.shape.properties?.[node.name.text];
          if (shape !== undefined) mergeFrozenShapeAtPath(state.root, path_, shape, state);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionLike.body);
}

/** Rejects JSX from non-selected direct switch clauses once an exact prop value is known. */
export function isInsideSelectedPropSwitchClause(node: ts.Node, state: InferenceState): boolean {
  let current = node;
  while (current !== state.functionLike) {
    if (ts.isCaseClause(current) || ts.isDefaultClause(current)) {
      const caseBlock = current.parent;
      const statement = caseBlock.parent;
      if (ts.isSwitchStatement(statement)) {
        const discriminantPath = readPropPath(statement.expression, state.aliases);
        const selected =
          discriminantPath === undefined
            ? undefined
            : readPreviewInferredExactValue(state, discriminantPath);
        if (selected !== undefined) {
          if (ts.isCaseClause(current)) {
            return (
              readLiteralValue(current.expression as ts.LiteralTypeNode['literal']) === selected
            );
          }
          const directCases = statement.caseBlock.clauses.filter(ts.isCaseClause);
          return !directCases.some(
            (clause) =>
              readLiteralValue(clause.expression as ts.LiteralTypeNode['literal']) === selected,
          );
        }
      }
    }
    if (ts.isSourceFile(current)) return true;
    current = current.parent;
  }
  return true;
}

/** Infers one function parameter as the root of a detached, budget-sharing item contract. */
export function inferFunctionBindingRequirement(
  functionLike: ExportedFunctionLike,
  binding: ts.BindingName,
  parentState: InferenceState,
  allowRenderedRootScalar = parentState.allowRenderedRootScalar,
): MutableShapeNode | undefined {
  const bindingRoot = '__reactPreviewBindingRoot';
  const root = createMutableNode('object', 'usage');
  const state: InferenceState = {
    activeLocalComponentNames: parentState.activeLocalComponentNames,
    allowRenderedRootScalar,
    aliases: new Map(),
    childPropDemands: parentState.childPropDemands,
    collectionDemandDepth: parentState.collectionDemandDepth + 1,
    functionLike,
    graphqlFragmentUnmaskBindings: parentState.graphqlFragmentUnmaskBindings,
    graphqlDocumentTypeNames: parentState.graphqlDocumentTypeNames,
    identityCollectionHelperParameters: parentState.identityCollectionHelperParameters,
    localComponents: parentState.localComponents,
    localComponentDemandDepth: parentState.localComponentDemandDepth,
    localTypes: parentState.localTypes,
    nodeLimit: parentState.nodeLimit,
    nodeCount: parentState.nodeCount,
    registryDiscriminantHints: parentState.registryDiscriminantHints,
    root,
    sourceFile: parentState.sourceFile,
  };
  collectParameterBindings(binding, [bindingRoot], state.aliases);
  const typedParameter = functionLike.parameters.find((parameter) => parameter.name === binding);
  collectLocalPropAliases(functionLike, state);
  collectUsageRequirements(functionLike, state);
  collectBoundedIndexReadLengths(functionLike, state);
  if (
    ts.isIdentifier(binding) &&
    typedParameter?.type !== undefined &&
    typedParameter.questionToken === undefined &&
    typedParameter.initializer === undefined &&
    typedParameter.dotDotDotToken === undefined
  ) {
    addTypeRequirement(
      [bindingRoot],
      typedParameter.type,
      state.localTypes,
      state,
      state.sourceFile,
      new Set(),
    );
  }
  collectRequiredPropertyReadTerminals(functionLike, state);
  collectEqualityDiscriminantRequirements(functionLike, state);
  collectSwitchDiscriminantRequirements(functionLike, state);
  collectTemplateTextReads(functionLike, state);
  parentState.nodeCount = state.nodeCount;
  return root.children.get(bindingRoot);
}
