/** Propagates recursive binding, indexed-item, and collection demands for runtime hooks. */
import ts from 'typescript';
import {
  inferPreviewRuntimeHookCallableSmartValue,
  readPreviewRuntimeHookAliasUsagePaths,
  type PreviewRuntimeHookAliasUsagePath as PreviewRuntimeHookUsagePath,
  type ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
} from './previewRuntimeHookAliasUsage';
import {
  createPreviewRuntimeHookObjectRestFallback,
  readPreviewRuntimeHookBindingPropertyName,
} from './previewRuntimeHookBindingPattern';
import {
  createPreviewRuntimeHookCallableFallback,
  createPreviewRuntimeHookCallResultFallback,
} from './previewRuntimeHookCallResult';
import {
  inferPreviewRuntimeHookJsxCollectionItemFallback,
  readPreviewRuntimeHookChildPropUsages,
} from './previewRuntimeHookChildPropDemand';
import { readPreviewRuntimeHookDestructuredPaths } from './previewRuntimeHookDestructuring';
import {
  createPreviewRuntimeHookDirectUsageFallback,
  createPreviewRuntimeHookRenderedTextExpression,
  isPreviewRuntimeHookCallableJsxValue,
  isPreviewRuntimeHookEmptyRenderableJsxValue,
  isPreviewRuntimeHookMutableRefJsxValue,
  isPreviewRuntimeHookTextValue,
} from './previewRuntimeHookDirectUsage';
import { inferPreviewRuntimeHookDynamicElementFallback } from './previewRuntimeHookDynamicElementDemand';
import {
  createPreviewRuntimeHookProjectionSafeFallback,
  prefixPreviewRuntimeHookPaths,
  prefixPreviewRuntimeHookSmartPathValues,
  readNestedPreviewRuntimeHookExpression,
} from './previewRuntimeHookFallbackSupport';
import {
  inferPreviewRuntimeHookCollectionLengthGuardPassValue,
  inferPreviewRuntimeHookExpressionLiteralGuardPassFallback,
  inferPreviewRuntimeHookExpressionThrowGuardPassFallback,
  inferPreviewRuntimeHookGuardPassFallback,
  inferPreviewRuntimeHookTargetExitFallback,
} from './previewRuntimeHookGuardValue';
import { readPreviewRuntimeHookIdentityAliasCollectionUsages } from './previewRuntimeHookIdentityAliases';
import { readPreviewRuntimeHookIndexedItemAliases } from './previewRuntimeHookIndexedItemCatalog';
import { inferPreviewRuntimeHookJsxComponentFallback } from './previewRuntimeHookJsxComponent';
import { inferPreviewRuntimeHookLayoutDimensionDemand } from './previewRuntimeHookLayoutDimensionDemand';
import {
  inferPreviewRuntimeLocalHelperArrayItemFallback,
  type PreviewRuntimeLocalHelperItemFallback,
} from './previewRuntimeHookLocalHelperItem';
import { inferPreviewRuntimeHookLocalScalarFallback } from './previewRuntimeHookLocalScalarDemand';
import { inferPreviewRuntimeHookMembershipItemFallback } from './previewRuntimeHookMembershipItem';
import {
  childPropDemandsBySourceFile,
  importedCollectionCallbackItemFallbackBySourceFile,
  importedHelperItemFallbackBySourceFile,
  importedHelperPropertyFallbackBySourceFile,
  INDEXED_ITEM_ALIAS_DYNAMIC_KEYS,
  localTypeFallbackBySourceFile,
  REDUCE_IDENTITY_CARRIER_METHODS,
  type PreviewRuntimeHookSmartPathValueExpression,
  type PreviewRuntimeHookValueFallback,
} from './previewRuntimeHookModel';
import { inferPreviewRuntimeHookOverlayStateDemand } from './previewRuntimeHookOverlayStateDemand';
import {
  isPreviewRuntimeHookArrayUsageProperty,
  isPreviewRuntimeHookStringUsageProperty,
  readPreviewRuntimeHookLiteralElementUsage,
  readPreviewRuntimeHookPropertyUsage,
  shouldMaterializePreviewRuntimeHookNestedFallback,
} from './previewRuntimeHookPropertyUsage';
import { inferPreviewRuntimeHookRenderableStateDemands } from './previewRuntimeHookRenderableStateDemand';
import { createPreviewRuntimeHookReferenceTraversal } from './previewRuntimeHookReferenceTraversal';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import { inferPreviewRuntimeHookSpreadItemFallback } from './previewRuntimeHookSpreadItem';
import { mergePreviewRuntimeHookCollectionContracts } from './previewRuntimeHookCollectionContract';
import {
  findNearestPreviewRuntimeFunction as findNearestRuntimeFunction,
  previewRuntimeFunctionShadowsName as functionShadowsName,
  isPreviewRuntimeFunction as isRuntimeFunction,
  unwrapPreviewRuntimeExpression as unwrapExpression,
  unwrapPreviewRuntimeParentExpression as unwrapParentExpression,
} from './previewRuntimeHookSyntax';
import {
  createPreviewGeneratedListExpression,
  createPreviewRuntimeHookUsageTreeFallback,
} from './previewRuntimeHookUsageTree';

/** Creates a binding fallback while leaving defaulted fields absent for authored JS initializers. */
export function createBindingFallback(
  binding: ts.BindingName,
  sourceFile: ts.SourceFile,
  callResultDepth = 0,
): PreviewRuntimeHookValueFallback | undefined {
  if (ts.isIdentifier(binding)) {
    const layoutDimensionDemand = inferPreviewRuntimeHookLayoutDimensionDemand(binding);
    const overlayStateDemand = inferPreviewRuntimeHookOverlayStateDemand(binding, sourceFile);
    const renderableStateDemands = inferPreviewRuntimeHookRenderableStateDemands(
      binding,
      sourceFile,
    );
    const withOverlayStateDemand = (
      fallback: PreviewRuntimeHookValueFallback,
    ): PreviewRuntimeHookValueFallback => {
      const safeFallback = createPreviewRuntimeHookProjectionSafeFallback(fallback);
      const smartPathValueExpressions = [
        ...(safeFallback.smartPathValueExpressions ?? []),
        ...(layoutDimensionDemand === undefined
          ? []
          : [
              Object.freeze({
                expression: layoutDimensionDemand.expression,
                path: layoutDimensionDemand.path,
              }),
            ]),
        ...(overlayStateDemand === undefined
          ? []
          : [Object.freeze({ expression: overlayStateDemand.expression, path: '<root>' })]),
        ...renderableStateDemands.map((demand) =>
          Object.freeze({
            deterministicRank: demand.deterministicRank,
            expression: demand.expression,
            path: demand.path,
            role: 'render-state' as const,
          }),
        ),
      ];
      return smartPathValueExpressions.length === 0
        ? safeFallback
        : {
            ...safeFallback,
            smartPathValueExpressions: Object.freeze(smartPathValueExpressions),
          };
    };
    const jsxComponent = inferPreviewRuntimeHookJsxComponentFallback(
      binding,
      sourceFile,
      callResultDepth,
      createBindingFallback,
    );
    if (jsxComponent !== undefined) return withOverlayStateDemand(jsxComponent);
    const usageShape = createIdentifierUsageFallback(binding, sourceFile, callResultDepth);
    if (usageShape !== undefined) return withOverlayStateDemand(usageShape);
    const targetExit = inferPreviewRuntimeHookTargetExitFallback(binding);
    if (targetExit !== undefined) {
      return withOverlayStateDemand({ ...targetExit, requiredPaths: ['<root>'] });
    }
    const semantic = inferPreviewRuntimeSemanticFallback(binding.text);
    const guardPass =
      semantic?.kind === 'boolean' ? inferPreviewRuntimeHookGuardPassFallback(binding) : undefined;
    if (guardPass !== undefined) {
      return withOverlayStateDemand({
        ...guardPass,
        renderGuardPaths: ['<root>'],
        requiredPaths: ['<root>'],
      });
    }
    const compared = inferPreviewRuntimeHookLocalScalarFallback(binding, sourceFile);
    if (compared !== undefined) {
      return withOverlayStateDemand({
        ...compared,
        ...(compared.renderGuard === true ? { renderGuardPaths: ['<root>'] } : {}),
        requiredPaths: ['<root>'],
      });
    }
    const directUsage = createPreviewRuntimeHookDirectUsageFallback(binding);
    if (directUsage?.callable === true) {
      return withOverlayStateDemand(
        createPreviewRuntimeHookCallableFallback(
          directUsage,
          sourceFile,
          callResultDepth,
          createBindingFallback,
        ),
      );
    }
    if (semantic !== undefined)
      return withOverlayStateDemand({ ...semantic, requiredPaths: ['<root>'] });
    if (directUsage !== undefined) {
      const guardPass =
        directUsage.label === 'generated boolean from local condition'
          ? inferPreviewRuntimeHookGuardPassFallback(binding)
          : undefined;
      if (guardPass !== undefined) {
        return withOverlayStateDemand({
          ...guardPass,
          renderGuardPaths: ['<root>'],
          requiredPaths: ['<root>'],
        });
      }
      return withOverlayStateDemand({
        ...directUsage,
        requiredPaths: ['<root>'],
      });
    }
    if (layoutDimensionDemand !== undefined) {
      return withOverlayStateDemand({
        expression: '0',
        label: 'generated zero layout dimension',
        requiredPaths: ['<root>'],
      });
    }
    return undefined;
  }
  if (ts.isArrayBindingPattern(binding)) {
    const values: string[] = [];
    const failurePaths: string[] = [];
    const renderGuardPaths: string[] = [];
    const smartPathValueExpressions: PreviewRuntimeHookSmartPathValueExpression[] = [];
    const requiredPaths: string[] = [];
    let projectionUnsafe = false;
    for (const [index, element] of binding.elements.entries()) {
      if (ts.isOmittedExpression(element)) {
        values.push('undefined');
        continue;
      }
      if (element.dotDotDotToken !== undefined) return undefined;
      if (element.initializer !== undefined) {
        values.push('undefined');
        continue;
      }
      const child = createBindingFallback(element.name, sourceFile, callResultDepth);
      if (child?.projectionUnsafe === true) projectionUnsafe = true;
      const propertyName = String(index);
      values.push(readNestedPreviewRuntimeHookExpression(child, propertyName));
      if (
        child?.failurePaths !== undefined &&
        shouldMaterializePreviewRuntimeHookNestedFallback(child, propertyName)
      ) {
        failurePaths.push(...prefixPreviewRuntimeHookPaths(child.failurePaths, String(index)));
      }
      renderGuardPaths.push(
        ...prefixPreviewRuntimeHookPaths(child?.renderGuardPaths ?? [], String(index)),
      );
      smartPathValueExpressions.push(
        ...prefixPreviewRuntimeHookSmartPathValues(
          child?.smartPathValueExpressions ?? [],
          String(index),
        ),
      );
      requiredPaths.push(...prefixPreviewRuntimeHookPaths(child?.requiredPaths, String(index)));
    }
    return {
      expression: `Object.freeze([${values.join(', ')}])`,
      ...(failurePaths.length === 0 ? {} : { failurePaths }),
      label: 'generated tuple',
      ...(projectionUnsafe ? { projectionUnsafe: true } : {}),
      ...(renderGuardPaths.length === 0 ? {} : { renderGuardPaths }),
      ...(smartPathValueExpressions.length === 0 ? {} : { smartPathValueExpressions }),
      requiredPaths,
    };
  }
  const properties: string[] = [];
  const failurePaths: string[] = [];
  const renderGuardPaths: string[] = [];
  const smartPathValueExpressions: PreviewRuntimeHookSmartPathValueExpression[] = [];
  const requiredPaths: string[] = [];
  let projectionUnsafe = false;
  for (const element of binding.elements) {
    if (element.dotDotDotToken !== undefined) {
      const rest = createPreviewRuntimeHookObjectRestFallback(
        createBindingFallback(element.name, sourceFile, callResultDepth),
      );
      if (rest.expression !== undefined) properties.push(rest.expression);
      if (rest.projectionUnsafe === true) projectionUnsafe = true;
      requiredPaths.push(...rest.requiredPaths);
      continue;
    }
    if (element.initializer !== undefined) continue;
    const propertyName = readPreviewRuntimeHookBindingPropertyName(element);
    if (propertyName === undefined) return undefined;
    const child: PreviewRuntimeHookValueFallback = createBindingFallback(
      element.name,
      sourceFile,
      callResultDepth,
    ) ?? {
      expression: 'Object.freeze({})',
      label: 'static object',
    };
    if (child.projectionUnsafe === true) projectionUnsafe = true;
    properties.push(
      `${JSON.stringify(propertyName)}: ${readNestedPreviewRuntimeHookExpression(child, propertyName)}`,
    );
    if (
      child.failurePaths !== undefined &&
      shouldMaterializePreviewRuntimeHookNestedFallback(child, propertyName)
    ) {
      failurePaths.push(...prefixPreviewRuntimeHookPaths(child.failurePaths, propertyName));
    }
    renderGuardPaths.push(
      ...prefixPreviewRuntimeHookPaths(child.renderGuardPaths ?? [], propertyName),
    );
    smartPathValueExpressions.push(
      ...prefixPreviewRuntimeHookSmartPathValues(
        child.smartPathValueExpressions ?? [],
        propertyName,
      ),
    );
    requiredPaths.push(...prefixPreviewRuntimeHookPaths(child.requiredPaths, propertyName));
  }
  return {
    expression: `Object.freeze({${properties.length === 0 ? '' : ` ${properties.join(', ')} `}})`,
    ...(failurePaths.length === 0 ? {} : { failurePaths }),
    label: 'generated object fields',
    ...(projectionUnsafe ? { projectionUnsafe: true } : {}),
    ...(renderGuardPaths.length === 0 ? {} : { renderGuardPaths }),
    ...(smartPathValueExpressions.length === 0 ? {} : { smartPathValueExpressions }),
    requiredPaths,
  };
}

/**
 * Builds a deep object from required property reads rooted at one bound hook result.
 * Array operations synthesize one callback-shaped item so list layouts become visible, while called
 * leaves become inert functions and semantic scalar leaves reuse the deterministic naming policy.
 */
export function createIdentifierUsageFallback(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
  callResultDepth: number,
): PreviewRuntimeHookValueFallback | undefined {
  const owner = findNearestRuntimeFunction(identifier);
  if (owner === undefined) return undefined;
  const visitReferencedChildren = createPreviewRuntimeHookReferenceTraversal(
    owner,
    new Set([identifier.text]),
  );
  const indexedItemAliasUsages = readPreviewRuntimeHookIndexedItemAliasUsages(
    identifier,
    owner,
    sourceFile,
    callResultDepth,
  );
  const dynamicElementFallback = inferPreviewRuntimeHookDynamicElementFallback(
    identifier,
    sourceFile,
    indexedItemAliasUsages.length === 0 ? undefined : INDEXED_ITEM_ALIAS_DYNAMIC_KEYS,
  );
  const paths: PreviewRuntimeHookUsagePath[] = [];
  const optionalPaths: PreviewRuntimeHookUsagePath[] = [];
  const arrayRootEvidence: string[] = [];
  const arrayItemFallbacks: PreviewRuntimeHookValueFallback[] = [];
  let optionalReferences = 0;
  let opaqueReferences = 0;
  let opaqueCallArgumentReferences = 0;
  let unsafeReferences = 0;
  const visit = (node: ts.Node): void => {
    if (node !== owner && isRuntimeFunction(node) && functionShadowsName(node, identifier.text)) {
      return;
    }
    if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
      const usagePath = readPreviewRuntimeHookPropertyUsage(node, identifier.text);
      if (usagePath !== undefined && usagePath.names.length > 0) {
        const collectionProperty = usagePath.names.at(-1);
        const spreadCollection = ts.isSpreadElement(node.parent);
        const membershipItemFallback = inferPreviewRuntimeHookMembershipItemFallback(
          node,
          usagePath.names.at(-2) ?? identifier.text,
          sourceFile,
        );
        const jsxCollectionItemFallback = inferPreviewRuntimeHookJsxCollectionItemFallback(
          identifier,
          node,
        );
        const directJsxCollection = jsxCollectionItemFallback !== undefined;
        const collection =
          spreadCollection ||
          isPreviewRuntimeHookArrayUsageProperty(collectionProperty) ||
          membershipItemFallback !== undefined ||
          directJsxCollection;
        const terminalCalled = ts.isCallExpression(node.parent) && node.parent.expression === node;
        const terminalCallable = terminalCalled || isPreviewRuntimeHookCallableJsxValue(node);
        const terminalMutableRef = isPreviewRuntimeHookMutableRefJsxValue(node);
        const terminalEmptyRenderable = isPreviewRuntimeHookEmptyRenderableJsxValue(node);
        const terminalRendered = isPreviewRuntimeHookTextValue(node);
        const renderedExpression = terminalRendered
          ? createPreviewRuntimeHookRenderedTextExpression(usagePath.names.at(-1))
          : undefined;
        const callResultFallback =
          terminalCalled && !collection && ts.isCallExpression(node.parent)
            ? createPreviewRuntimeHookCallResultFallback(
                node.parent,
                sourceFile,
                callResultDepth + 1,
                createBindingFallback,
              )
            : undefined;
        const smartCallable = terminalCalled
          ? inferPreviewRuntimeHookCallableSmartValue(node)
          : undefined;
        const collectionLengthRequiresItem =
          collectionProperty === 'length' &&
          inferPreviewRuntimeHookCollectionLengthGuardPassValue(node) === true;
        const collectionItemFallback: PreviewRuntimeLocalHelperItemFallback | undefined =
          membershipItemFallback ??
          jsxCollectionItemFallback ??
          (usagePath.collectionItemType === undefined
            ? spreadCollection
              ? inferPreviewRuntimeHookSpreadItemFallback(node)
              : terminalCalled
                ? inferPreviewRuntimeArrayItemFallback(node, identifier.getSourceFile())
                : collectionLengthRequiresItem
                  ? {
                      expression: 'Object.freeze({ id: "preview-id", name: "name" })',
                      label: 'generated item required by collection length guard',
                      requiredPaths: ['id', 'name'],
                    }
                  : undefined
            : localTypeFallbackBySourceFile
                .get(identifier.getSourceFile())
                ?.call(undefined, usagePath.collectionItemType));
        const stringReceiver =
          terminalCalled &&
          isPreviewRuntimeHookStringUsageProperty(collectionProperty) &&
          inferPreviewRuntimeSemanticFallback(usagePath.names.at(-2) ?? identifier.text)?.label !==
            'generated object';
        const guardPass =
          !terminalCalled && !collection && !stringReceiver
            ? (inferPreviewRuntimeHookExpressionLiteralGuardPassFallback(
                node,
                identifier.getStart(sourceFile),
              ) ?? inferPreviewRuntimeHookExpressionThrowGuardPassFallback(node))
            : undefined;
        const guardSemantic = inferPreviewRuntimeSemanticFallback(
          usagePath.names.at(-1) ?? identifier.text,
        );
        const guardValueExpression =
          guardPass === undefined
            ? undefined
            : guardPass.kind === 'boolean' && guardSemantic?.kind !== 'boolean'
              ? guardSemantic?.expression
              : guardPass.expression;
        const valueExpression = terminalMutableRef
          ? '({ current: null })'
          : terminalEmptyRenderable
            ? 'null'
            : (guardValueExpression ?? renderedExpression);
        if (
          !usagePath.optional &&
          collection &&
          !spreadCollection &&
          !directJsxCollection &&
          usagePath.names.length === 1
        ) {
          arrayRootEvidence.push(usagePath.names[0] ?? 'array operation');
          if (collectionItemFallback !== undefined) {
            arrayItemFallbacks.push(collectionItemFallback);
          }
        } else if (paths.length + optionalPaths.length < 64 && usagePath.names.length <= 12) {
          const target = usagePath.optional ? optionalPaths : paths;
          target.push({
            called: !collection && !stringReceiver && terminalCallable,
            ...(callResultFallback === undefined
              ? {}
              : { callResultExpression: callResultFallback.expression }),
            ...(collectionItemFallback?.expression === undefined
              ? {}
              : { collectionItemExpression: collectionItemFallback.expression }),
            ...(collectionItemFallback?.generatedStringIdentity === true
              ? { collectionItemStringIdentity: true as const }
              : {}),
            ...(collectionItemFallback?.requiredPaths === undefined
              ? {}
              : {
                  collectionItemRequiredPaths: Object.freeze([
                    ...collectionItemFallback.requiredPaths,
                  ]),
                }),
            ...(collection
              ? {
                  collectionProperty: directJsxCollection
                    ? 'jsx-collection-prop'
                    : spreadCollection
                      ? 'spread'
                      : (collectionProperty ?? ''),
                }
              : {}),
            names: directJsxCollection
              ? usagePath.names
              : (collection && !spreadCollection) || stringReceiver
                ? usagePath.names.slice(0, -1)
                : usagePath.names,
            ...(guardPass === undefined ? {} : { renderGuard: true as const }),
            ...(smartCallable === undefined
              ? {}
              : {
                  smartValueExpression: smartCallable.expression,
                  smartValueRole: smartCallable.role,
                }),
            ...(stringReceiver ? { stringProperty: collectionProperty ?? '' } : {}),
            /* Rendering `rows.length` consumes a scalar result, not a numeric rows receiver. */
            ...(valueExpression === undefined || collection ? {} : { valueExpression }),
          });
        }
      }
    }
    if (ts.isElementAccessExpression(node) && paths.length + optionalPaths.length < 64) {
      const elementUsage = readPreviewRuntimeHookLiteralElementUsage(node, identifier.text);
      if (elementUsage !== undefined) {
        const itemFallback = createPreviewRuntimeHookUsageTreeFallback([
          {
            called: elementUsage.itemCalled,
            names: elementUsage.itemNames,
            ...(elementUsage.itemValueExpression === undefined
              ? {}
              : { valueExpression: elementUsage.itemValueExpression }),
          },
        ]);
        paths.push({
          called: false,
          collectionItemExpression: itemFallback.expression,
          collectionItemRequiredPaths: itemFallback.requiredPaths,
          collectionProperty: '[]',
          names: elementUsage.receiverNames,
        });
      }
    }
    if (ts.isIdentifier(node) && node.text === identifier.text && node !== identifier) {
      const parent = node.parent;
      const argumentExpression = unwrapParentExpression(node);
      const argument =
        ts.isSpreadElement(argumentExpression.parent) &&
        argumentExpression.parent.expression === argumentExpression
          ? argumentExpression.parent
          : argumentExpression;
      const opaqueCallArgument =
        ts.isCallExpression(argument.parent) &&
        argument.parent.arguments.some((candidate) => candidate === argument);
      const optionalPropertyRoot =
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        parent.questionDotToken !== undefined;
      const optionalElementRoot =
        ts.isElementAccessExpression(parent) &&
        parent.expression === node &&
        parent.questionDotToken !== undefined;
      const optionalCallRoot =
        ts.isCallExpression(parent) &&
        parent.expression === node &&
        parent.questionDotToken !== undefined;
      const passiveDependency = ts.isArrayLiteralExpression(parent);
      const passiveObjectProperty =
        ts.isShorthandPropertyAssignment(parent) ||
        (ts.isPropertyAssignment(parent) && parent.initializer === node);
      const handledPropertyRoot =
        ts.isPropertyAccessExpression(parent) && parent.expression === node;
      const handledCallRoot = ts.isCallExpression(parent) && parent.expression === node;
      const propertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (optionalPropertyRoot || optionalElementRoot || optionalCallRoot) {
        optionalReferences += 1;
      } else if (!passiveDependency && !passiveObjectProperty) {
        unsafeReferences += 1;
        if (!handledPropertyRoot && !handledCallRoot && !propertyName) {
          opaqueReferences += 1;
          if (opaqueCallArgument) opaqueCallArgumentReferences += 1;
        }
      }
    }
    if (ts.isVariableDeclaration(node)) {
      for (const names of readPreviewRuntimeHookDestructuredPaths(node, identifier.text)) {
        if (paths.length >= 64) break;
        paths.push({ called: false, names });
      }
    }
    visitReferencedChildren(node, visit);
  };
  visit(owner);
  paths.push(...indexedItemAliasUsages);
  for (const usage of readPreviewRuntimeHookIdentityAliasCollectionUsages(identifier, owner))
    (usage.optional ? optionalPaths : paths).push({ called: false, ...usage });
  const childPropUsages = readPreviewRuntimeHookChildPropUsages(
    identifier,
    childPropDemandsBySourceFile.get(identifier.getSourceFile()),
  );
  const childProvenCollectionPaths = new Set(
    childPropUsages
      .filter((usage) => usage.collectionProperty !== undefined)
      .map((usage) => usage.names.join('.')),
  );
  paths.push(
    ...readPreviewRuntimeHookAliasUsagePaths(
      identifier,
      owner,
      importedHelperItemFallbackBySourceFile.get(identifier.getSourceFile()),
      importedHelperPropertyFallbackBySourceFile.get(identifier.getSourceFile()),
      importedCollectionCallbackItemFallbackBySourceFile.get(identifier.getSourceFile()),
      childProvenCollectionPaths,
      false,
      (access) => inferPreviewRuntimeArrayItemFallback(access, identifier.getSourceFile()),
    ),
  );
  /*
   * A hook array may reach a child through an identity-preserving transform such as
   * `items.filter(... )`. Such a carrier has no property-name prefix, so retain its inferred child
   * item beside callback-derived candidates instead of trying to serialize it as an object path.
   */
  for (const usage of childPropUsages) {
    if (usage.names.length === 0 && usage.collectionProperty !== undefined) {
      arrayRootEvidence.push('child component collection prop');
      if (usage.collectionItemExpression !== undefined) {
        arrayItemFallbacks.push({
          expression: usage.collectionItemExpression,
          label: 'generated child component collection item',
          requiredPaths: usage.collectionItemRequiredPaths ?? [],
        });
      }
    } else {
      paths.push(usage);
    }
  }
  const jsxCollectionItemFallback = inferPreviewRuntimeHookJsxCollectionItemFallback(identifier);
  if (jsxCollectionItemFallback !== undefined) {
    arrayRootEvidence.push('JSX collection configuration');
    arrayItemFallbacks.push(jsxCollectionItemFallback);
  }
  if (arrayRootEvidence.length > 0) {
    const item: PreviewRuntimeLocalHelperItemFallback = [...arrayItemFallbacks].sort(
      (left, right) => (right.requiredPaths?.length ?? 0) - (left.requiredPaths?.length ?? 0),
    )[0] ?? {
      expression: 'Object.freeze({ id: "preview-id", name: "name" })',
      label: 'generated generic preview item',
      requiredPaths: ['id', 'name'],
    };
    const exactMembership = item.label === 'authored collection membership item';
    const mergedItem = exactMembership
      ? undefined
      : mergePreviewRuntimeHookCollectionContracts(
          item.expression,
          arrayItemFallbacks.map((fallback) => fallback.expression),
        );
    return {
      expression: exactMembership
        ? `Object.freeze([${item.expression}])`
        : createPreviewGeneratedListExpression(
            mergedItem ?? item.expression,
            item.generatedStringIdentity === true,
          ),
      label: exactMembership
        ? 'generated one-item list from local usage'
        : 'generated sample list from local usage',
      ...(opaqueCallArgumentReferences > 0 ? { neutralCollectionOnOpaqueCall: true } : {}),
      ...(opaqueReferences > 0 ? { projectionUnsafe: true } : {}),
      requiredPaths: prefixPreviewRuntimeHookPaths(item.requiredPaths, '[]'),
    };
  }
  if (paths.length === 0 && dynamicElementFallback !== undefined) {
    return opaqueReferences === 0
      ? dynamicElementFallback
      : { ...dynamicElementFallback, projectionUnsafe: true };
  }
  if (paths.length === 0 && unsafeReferences === 0) {
    if (optionalReferences === 0) return undefined;
    const optionalFallback = createPreviewRuntimeHookUsageTreeFallback(optionalPaths);
    return {
      expression: optionalFallback.expression,
      failurePaths: optionalFallback.requiredPaths,
      label: 'generated optional failure shape',
      preserveNullish: true,
      ...(opaqueReferences > 0 ? { projectionUnsafe: true } : {}),
      ...(optionalFallback.smartPathValueExpressions.length === 0
        ? {}
        : { smartPathValueExpressions: optionalFallback.smartPathValueExpressions }),
      requiredPaths: [],
    };
  }
  if (paths.length === 0 && optionalPaths.length === 0) return undefined;
  const fallback = createPreviewRuntimeHookUsageTreeFallback([...paths, ...optionalPaths]);
  if (dynamicElementFallback !== undefined) {
    return {
      expression: `Object.freeze(Object.assign({}, ${fallback.expression}, ${dynamicElementFallback.expression}))`,
      label: 'generated required and computed property shape',
      ...(fallback.renderGuardPaths.length === 0
        ? {}
        : { renderGuardPaths: fallback.renderGuardPaths }),
      ...(opaqueReferences > 0 ? { projectionUnsafe: true } : {}),
      ...(fallback.smartPathValueExpressions.length === 0
        ? {}
        : { smartPathValueExpressions: fallback.smartPathValueExpressions }),
      requiredPaths: Object.freeze([
        ...new Set([...fallback.requiredPaths, ...dynamicElementFallback.requiredPaths]),
      ]),
    };
  }
  return {
    expression: fallback.expression,
    label: 'generated required property shape',
    ...(opaqueReferences > 0 ? { projectionUnsafe: true } : {}),
    ...(fallback.renderGuardPaths.length === 0
      ? {}
      : { renderGuardPaths: fallback.renderGuardPaths }),
    ...(fallback.smartPathValueExpressions.length === 0
      ? {}
      : { smartPathValueExpressions: fallback.smartPathValueExpressions }),
    requiredPaths: fallback.requiredPaths,
  };
}

/**
 * Carries item demand through one exact immutable `const item = collection[0]` local alias.
 *
 * This deliberately stays narrower than general identity aliases: only a unique same-function
 * binding from the literal zero index is admitted, and nested scopes that reuse either local make
 * the proof ambiguous. The item fallback is still derived entirely from syntax; no authored code
 * is evaluated.
 */
export function readPreviewRuntimeHookIndexedItemAliasUsages(
  identifier: ts.Identifier,
  owner: ReturnType<typeof findNearestRuntimeFunction>,
  sourceFile: ts.SourceFile,
  callResultDepth: number,
): readonly PreviewRuntimeHookUsagePath[] {
  if (owner === undefined) return [];
  const usages: PreviewRuntimeHookUsagePath[] = [];
  for (const alias of readPreviewRuntimeHookIndexedItemAliases(owner, identifier.text)) {
    const item = createIdentifierUsageFallback(alias, sourceFile, callResultDepth);
    if (item === undefined || item.projectionUnsafe === true) continue;
    usages.push({
      called: false,
      collectionItemExpression: item.expression,
      ...(item.requiredPaths === undefined
        ? {}
        : { collectionItemRequiredPaths: item.requiredPaths }),
      collectionProperty: '[]',
      names: [],
    });
  }
  return usages;
}

/** Infers callback fields with imported-helper evidence scoped to this synchronous parser pass. */
export const inferPreviewRuntimeArrayItemFallback = (
  propertyAccess: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  importedHelperPropertyFallback?: ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
): PreviewRuntimeLocalHelperItemFallback | undefined => {
  if (importedHelperPropertyFallback === undefined) {
    return inferRuntimeArrayItemFallback(propertyAccess, sourceFile);
  }
  const previousResolver = importedHelperPropertyFallbackBySourceFile.get(sourceFile);
  importedHelperPropertyFallbackBySourceFile.set(sourceFile, importedHelperPropertyFallback);
  try {
    return inferRuntimeArrayItemFallback(propertyAccess, sourceFile);
  } finally {
    if (previousResolver === undefined)
      importedHelperPropertyFallbackBySourceFile.delete(sourceFile);
    else importedHelperPropertyFallbackBySourceFile.set(sourceFile, previousResolver);
  }
};

/** Reads item requirements from the callback and any identity-preserving chain into reduce. */
export function inferRuntimeArrayItemFallback(
  propertyAccess: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
): PreviewRuntimeLocalHelperItemFallback | undefined {
  const primary = inferPreviewRuntimeLocalHelperArrayItemFallback(
    propertyAccess,
    sourceFile,
    createBindingFallback,
  );
  const reducePropertyAccess = findPreviewRuntimeIdentityChainedReduce(propertyAccess);
  if (reducePropertyAccess === undefined) return primary;
  const call = reducePropertyAccess.parent;
  const callbackArgument =
    ts.isCallExpression(call) && call.expression === reducePropertyAccess
      ? call.arguments[0]
      : undefined;
  const callback = callbackArgument === undefined ? undefined : unwrapExpression(callbackArgument);
  if (
    callback === undefined ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  ) {
    return primary;
  }
  const itemParameter = callback.parameters[1];
  if (itemParameter === undefined || itemParameter.dotDotDotToken !== undefined) return primary;
  const item = createBindingFallback(itemParameter.name, sourceFile);
  if (item === undefined) return primary;
  if (primary === undefined) return item;
  if (
    !primary.expression.startsWith('Object.freeze({') ||
    !item.expression.startsWith('Object.freeze({')
  ) {
    return primary;
  }
  return {
    expression: `Object.freeze(Object.assign({}, ${primary.expression}, ${item.expression}))`,
    label: 'generated reduce collection item',
    requiredPaths: Object.freeze([
      ...new Set([...(primary.requiredPaths ?? []), ...(item.requiredPaths ?? [])]),
    ]),
  };
}

/** Follows only identity-preserving Array operations from one reached receiver into `reduce`. */
export function findPreviewRuntimeIdentityChainedReduce(
  propertyAccess: ts.PropertyAccessExpression,
): ts.PropertyAccessExpression | undefined {
  let current = propertyAccess;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current.name.text === 'reduce') return current;
    if (!REDUCE_IDENTITY_CARRIER_METHODS.has(current.name.text)) return undefined;
    const call = current.parent;
    if (!ts.isCallExpression(call) || call.expression !== current) return undefined;
    const callValue = unwrapParentExpression(call);
    const next = callValue.parent;
    if (!ts.isPropertyAccessExpression(next) || next.expression !== callValue) return undefined;
    current = next;
  }
  return undefined;
}
