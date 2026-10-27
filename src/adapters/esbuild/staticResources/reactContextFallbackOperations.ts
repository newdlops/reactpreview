/** Infers required Context receivers from authored property, call, and JSX operations. */
import ts from 'typescript';
import type {
  ResolvePreviewRuntimeHookImportedHelperItemFallback,
  ResolvePreviewRuntimeHookImportedHelperParameterFallback,
} from './previewRuntimeHookAliasUsage';
import {
  createPreviewRuntimeHookRenderedTextExpression,
  isPreviewRuntimeHookTemplateTextValue,
} from './previewRuntimeHookDirectUsage';
import { inferPreviewRuntimeArrayItemFallback } from './previewRuntimeHookInstrumentation';
import { inferPreviewRuntimeHookLocalScalarFallback } from './previewRuntimeHookLocalScalarDemand';
import { inferPreviewRuntimeHookMembershipItemFallback } from './previewRuntimeHookMembershipItem';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import {
  isRootedAtCandidate,
  readHookBoundValue,
  recordOptionalBase,
} from './reactContextFallbackBindings';
import {
  COLLECTION_ITEM_CALLBACK_METHODS,
  COLLECTION_METHOD_NAMES,
  MAX_FALLBACK_PATHS,
  type FallbackShape,
  type HookBoundValue,
  type HookFallbackPlan,
  type RuntimeFunction,
} from './reactContextFallbackModel';
import {
  addCallableLeaf,
  addCollectionLeaf,
  addObjectContainer,
  addProperObjectPrefixes,
  addScalarLeaf,
  isSafePath,
  isWriteTarget,
  readCallableResultExpression,
} from './reactContextFallbackShape';
import { unwrapExpression, visitDirectScopeNodes } from './reactContextFallbackSyntax';
import {
  isObjectInspectionCall,
  readLocalFunctionSummary,
  type LocalFunctionSummary,
} from './reactContextLocalFunctionSummary';

/**
 * Inspects direct scope operations and records only immediate JavaScript shape requirements.
 * Unknown function arguments and leaf reads remain value-free; unsupported access rooted at the
 * candidate invalidates the rewrite rather than introducing a Proxy or guessed application value.
 */
export function inspectScopeOperations(
  scope: RuntimeFunction,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
  localFunctions: ReadonlyMap<string, LocalFunctionSummary>,
  localReturnFunctions: ReadonlyMap<string, RuntimeFunction>,
  globalObjectShadowed: boolean,
  resolveImportedCollectionCallbackItem:
    ResolvePreviewRuntimeHookImportedHelperItemFallback | undefined,
  resolveImportedHelperParameter:
    ResolvePreviewRuntimeHookImportedHelperParameterFallback | undefined,
): void {
  visitDirectScopeNodes(scope, (node) => {
    if (plan.invalid) return;
    if (ts.isIdentifier(node)) {
      inspectBoundScalarIdentifier(node, bindings, plan);
    }
    if (
      ts.isElementAccessExpression(node) &&
      isRootedAtCandidate(node.expression, bindings, plan)
    ) {
      plan.invalid = true;
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      inspectPropertyAccess(node, bindings, plan, localReturnFunctions);
      return;
    }
    if (ts.isJsxAttribute(node)) {
      inspectJsxAttribute(node, bindings, plan, localReturnFunctions);
      return;
    }
    if (ts.isCallExpression(node) && node !== plan.candidate.call) {
      inspectCallExpression(
        node,
        bindings,
        plan,
        localFunctions,
        localReturnFunctions,
        globalObjectShadowed,
        resolveImportedCollectionCallbackItem,
        resolveImportedHelperParameter,
      );
    }
  });
}

/**
 * Materializes a used destructured Boolean/number/string/null leaf without guessing objects.
 * A leaf without name or guard evidence stays absent unless an untagged template prints it.
 */
export function inspectBoundScalarIdentifier(
  identifier: ts.Identifier,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
): void {
  const resolved = bindings.get(identifier.text);
  if (resolved === undefined || resolved.paths.length === 0) return;
  if (!isRuntimeValueIdentifierReference(identifier)) return;
  for (const valuePath of resolved.paths) {
    if (valuePath.length === 0) continue;
    const localScalar = inferPreviewRuntimeHookLocalScalarFallback(
      identifier,
      identifier.getSourceFile(),
    );
    const guardedScalar = localScalar?.renderGuard === true ? localScalar : undefined;
    const semantic = inferPreviewRuntimeSemanticFallback(valuePath.at(-1) ?? identifier.text);
    const scalarExpression =
      guardedScalar?.expression ??
      (semantic !== undefined && ['boolean', 'null', 'number', 'string'].includes(semantic.kind)
        ? semantic.expression
        : undefined);
    if (scalarExpression === undefined) {
      if (isPreviewRuntimeHookTemplateTextValue(identifier))
        recordTemplateTextPath(valuePath, plan);
      continue;
    }
    plan.required = true;
    if (
      !addProperObjectPrefixes(valuePath, plan) ||
      !addScalarLeaf(valuePath, scalarExpression, plan)
    ) {
      plan.invalid = true;
      return;
    }
    if (guardedScalar !== undefined) plan.renderGuardPaths.add(valuePath.join('.'));
  }
}

/** Rejects declaration/property-name identifiers while admitting runtime value references. */
export function isRuntimeValueIdentifierReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (
    (ts.isBindingElement(parent) &&
      (parent.name === identifier || parent.propertyName === identifier)) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isMethodDeclaration(parent) && parent.name === identifier) ||
    (ts.isPropertyDeclaration(parent) && parent.name === identifier) ||
    (ts.isJsxAttribute(parent) && parent.name === identifier) ||
    (ts.isJsxOpeningElement(parent) && parent.tagName === identifier) ||
    (ts.isJsxClosingElement(parent) && parent.tagName === identifier) ||
    (ts.isJsxSelfClosingElement(parent) && parent.tagName === identifier) ||
    ts.isTypeNode(parent)
  ) {
    return false;
  }
  return true;
}

/** Records object prefixes for a non-optional property read and a callable terminal when invoked. */
export function inspectPropertyAccess(
  expression: ts.PropertyAccessExpression,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
  localReturnFunctions: ReadonlyMap<string, RuntimeFunction>,
): void {
  if (expression.questionDotToken !== undefined) {
    // An optional segment does not itself require a fallback. Record its receiver so a fallback
    // already required elsewhere is admitted only when that receiver stays absent and therefore
    // preserves the authored short circuit. Outer operations remain unresolved through this
    // segment instead of inventing work that the original application would never execute.
    if (
      isRootedAtCandidate(expression.expression, bindings, plan) &&
      !recordOptionalBase(expression.expression, bindings, plan, localReturnFunctions)
    ) {
      plan.invalid = true;
    }
    return;
  }
  if (
    ts.isCallExpression(expression.parent) &&
    expression.parent.expression === expression &&
    COLLECTION_METHOD_NAMES.has(expression.name.text)
  ) {
    // The call visitor records the receiver itself as a collection. Treating this intermediate
    // method property as an object/callable path first would create contradictory shape evidence.
    return;
  }
  if (expression.name.text === 'length') {
    const receiver = readHookBoundValue(
      expression.expression,
      bindings,
      plan.candidate.call,
      localReturnFunctions,
    );
    if (receiver === undefined) return;
    plan.required = true;
    for (const receiverPath of receiver.paths) {
      const semantic = inferPreviewRuntimeSemanticFallback(receiverPath.at(-1) ?? '');
      const valid =
        semantic?.kind === 'string'
          ? addScalarLeaf(receiverPath, semantic.expression, plan)
          : addCollectionLeaf(receiverPath, plan);
      if (!addProperObjectPrefixes(receiverPath, plan) || !valid) {
        plan.invalid = true;
        return;
      }
    }
    return;
  }
  const resolved = readHookBoundValue(
    expression,
    bindings,
    plan.candidate.call,
    localReturnFunctions,
  );
  if (resolved === undefined) return;
  if (isWriteTarget(expression)) {
    plan.invalid = true;
    return;
  }
  plan.required = true;
  const templateText = isPreviewRuntimeHookTemplateTextValue(expression);
  for (const valuePath of resolved.paths) {
    if (!addProperObjectPrefixes(valuePath, plan)) {
      plan.invalid = true;
      return;
    }
    if (templateText) recordTemplateTextPath(valuePath, plan);
  }
}

/** Records a leaf that an untagged template prints; JSX children of absent leaves render nothing. */
export function recordTemplateTextPath(path_: readonly string[], plan: HookFallbackPlan): void {
  if (path_.length > 0 && plan.templateTextPaths.size < MAX_FALLBACK_PATHS) {
    plan.templateTextPaths.set(path_.join('\0'), path_);
  }
}

/**
 * Gives a template-printed leaf its key label, which would otherwise print "undefined" (payroll
 * "undefined차"). It runs after all other evidence and only below already materialized object
 * containers, so it never creates a receiver, never overrides name/type evidence, and a conflict
 * skips the label instead of invalidating the whole fallback.
 */
export function addTemplateTextLeaf(path_: readonly string[], plan: HookFallbackPlan): void {
  if (plan.invalid || !isSafePath(path_)) return;
  const key = path_.join('\0');
  const kinds = ['callable', 'collection', 'object', 'scalar'] as const;
  if (kinds.some((kind) => plan.shapePaths.has(`${key}\0${kind}`))) return;
  let node: FallbackShape | undefined = plan.shape;
  for (const propertyName of path_.slice(0, -1)) {
    node = node.children.get(propertyName);
    if (node?.kind !== 'object') return;
  }
  if (node.children.has(path_.at(-1) ?? '')) return;
  addScalarLeaf(path_, createPreviewRuntimeHookRenderedTextExpression(path_.at(-1)), plan);
}

/** Handles calls through derived context properties plus bounded local object-inspection evidence. */
export function inspectCallExpression(
  call: ts.CallExpression,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
  localFunctions: ReadonlyMap<string, LocalFunctionSummary>,
  localReturnFunctions: ReadonlyMap<string, RuntimeFunction>,
  globalObjectShadowed: boolean,
  resolveImportedCollectionCallbackItem:
    ResolvePreviewRuntimeHookImportedHelperItemFallback | undefined,
  resolveImportedHelperParameter:
    ResolvePreviewRuntimeHookImportedHelperParameterFallback | undefined,
): void {
  if (call.questionDotToken !== undefined && isRootedAtCandidate(call.expression, bindings, plan)) {
    if (!recordOptionalBase(call.expression, bindings, plan, localReturnFunctions)) {
      plan.invalid = true;
    }
    return;
  }
  const callee = readHookBoundValue(
    call.expression,
    bindings,
    plan.candidate.call,
    localReturnFunctions,
  );
  if (callee !== undefined) {
    const collectionPaths = callee.paths.flatMap((calleePath) => {
      const methodName = calleePath.at(-1);
      const receiverPath = calleePath.slice(0, -1);
      return methodName !== undefined &&
        COLLECTION_METHOD_NAMES.has(methodName) &&
        receiverPath.length > 0
        ? [{ methodName, receiverPath }]
        : [];
    });
    if (collectionPaths.length > 0) {
      plan.required = true;
      const callback = call.arguments[0];
      const callbackValue =
        callback === undefined || ts.isSpreadElement(callback)
          ? undefined
          : unwrapExpression(callback);
      const collectionMethod = collectionPaths[0]?.methodName;
      const propertyAccess = unwrapExpression(call.expression);
      const membershipItem =
        collectionMethod === 'includes' && ts.isPropertyAccessExpression(propertyAccess)
          ? inferPreviewRuntimeHookMembershipItemFallback(
              propertyAccess,
              collectionPaths[0]?.receiverPath.at(-1) ?? '',
              call.getSourceFile(),
              true,
            )
          : undefined;
      const callbackItem =
        collectionMethod !== undefined &&
        COLLECTION_ITEM_CALLBACK_METHODS.has(collectionMethod) &&
        callbackValue !== undefined &&
        ts.isIdentifier(callbackValue)
          ? resolveImportedCollectionCallbackItem?.(callbackValue.text, 0)
          : collectionMethod !== undefined &&
              COLLECTION_ITEM_CALLBACK_METHODS.has(collectionMethod) &&
              ts.isPropertyAccessExpression(propertyAccess)
            ? inferPreviewRuntimeArrayItemFallback(
                propertyAccess,
                call.getSourceFile(),
                plan.resolveImportedHelperProperty,
              )
            : undefined;
      const collectionItem = membershipItem ?? callbackItem;
      for (const { receiverPath } of collectionPaths) {
        if (
          !addProperObjectPrefixes(receiverPath, plan) ||
          !addCollectionLeaf(receiverPath, plan, collectionItem, membershipItem !== undefined)
        ) {
          plan.invalid = true;
          return;
        }
      }
      return;
    }
    const callResultExpression = readCallableResultExpression(call, plan);
    plan.required = true;
    if (callResultExpression === null) return;
    if (
      callResultExpression === false ||
      callee.paths.some((calleePath) => calleePath.length === 0)
    ) {
      plan.invalid = true;
      return;
    }
    for (const calleePath of callee.paths) {
      if (
        !addProperObjectPrefixes(calleePath, plan) ||
        !addCallableLeaf(calleePath, plan, callResultExpression)
      ) {
        plan.invalid = true;
        return;
      }
    }
    return;
  }

  if (!globalObjectShadowed && isObjectInspectionCall(call)) {
    const argument = call.arguments[0];
    const resolved =
      argument === undefined
        ? undefined
        : readHookBoundValue(argument, bindings, plan.candidate.call, localReturnFunctions);
    if (resolved !== undefined) {
      for (const valuePath of resolved.paths) {
        if (!addObjectContainer(valuePath, plan)) {
          plan.invalid = true;
          break;
        }
      }
    }
    return;
  }

  const localSummary = readLocalFunctionSummary(call.expression, localFunctions);
  if (localSummary !== undefined) {
    for (const [parameterIndex, relativePaths] of localSummary.objectPathsByParameter) {
      const argument = call.arguments[parameterIndex];
      const resolved =
        argument === undefined
          ? undefined
          : readHookBoundValue(argument, bindings, plan.candidate.call, localReturnFunctions);
      if (resolved === undefined) continue;
      for (const relativePath of relativePaths) {
        for (const valuePath of resolved.paths) {
          if (!addObjectContainer([...valuePath, ...relativePath], plan)) {
            plan.invalid = true;
            return;
          }
        }
      }
    }
  }
  inspectImportedHelperParameterDemand(
    call,
    bindings,
    plan,
    localReturnFunctions,
    resolveImportedHelperParameter,
  );
  if (plan.invalid) return;
  for (const [parameterIndex, argument] of call.arguments.entries()) {
    // An Object.keys/entries/values demand proves a dictionary receiver. A plural field name
    // must not replace that stronger evidence with an Array and invalidate the whole fallback.
    if (localSummary?.objectPathsByParameter.has(parameterIndex) === true) continue;
    const resolved = readHookBoundValue(
      argument,
      bindings,
      plan.candidate.call,
      localReturnFunctions,
    );
    for (const valuePath of resolved?.paths ?? []) {
      if (
        looksLikeStrongContextCollectionName(valuePath.at(-1)) &&
        !addCollectionLeaf(valuePath, plan)
      ) {
        plan.invalid = true;
        return;
      }
    }
  }
}

/** Carries a hook-derived argument into the operation-proven shape of an imported helper. */
export function inspectImportedHelperParameterDemand(
  call: ts.CallExpression,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
  localReturnFunctions: ReadonlyMap<string, RuntimeFunction>,
  resolveImportedHelperParameter:
    ResolvePreviewRuntimeHookImportedHelperParameterFallback | undefined,
): void {
  if (resolveImportedHelperParameter === undefined || call.questionDotToken !== undefined) return;
  const callee = unwrapExpression(call.expression);
  if (!ts.isIdentifier(callee)) return;
  for (const [parameterIndex, argument] of call.arguments.entries()) {
    if (ts.isSpreadElement(argument)) continue;
    const resolved = readHookBoundValue(
      argument,
      bindings,
      plan.candidate.call,
      localReturnFunctions,
    );
    if (resolved === undefined) continue;
    const fallback = resolveImportedHelperParameter(callee.text, parameterIndex);
    if (fallback?.nestedUsages === undefined || fallback.nestedUsages.length === 0) continue;
    plan.required = true;
    for (const basePath of resolved.paths) {
      for (const usage of fallback.nestedUsages) {
        const valuePath = [...basePath, ...usage.names];
        const item =
          usage.collectionItemExpression === undefined
            ? undefined
            : {
                expression: usage.collectionItemExpression,
                ...(usage.collectionItemRequiredPaths === undefined
                  ? {}
                  : { requiredPaths: usage.collectionItemRequiredPaths }),
              };
        const valid =
          usage.collectionProperty !== undefined
            ? addProperObjectPrefixes(valuePath, plan) && addCollectionLeaf(valuePath, plan, item)
            : usage.called
              ? addProperObjectPrefixes(valuePath, plan) && addCallableLeaf(valuePath, plan)
              : usage.valueExpression !== undefined
                ? addProperObjectPrefixes(valuePath, plan) &&
                  addScalarLeaf(valuePath, usage.valueExpression, plan)
                : usage.stringProperty !== undefined
                  ? addProperObjectPrefixes(valuePath, plan) &&
                    addScalarLeaf(
                      valuePath,
                      inferPreviewRuntimeSemanticFallback(valuePath.at(-1) ?? '')?.expression ??
                        '""',
                      plan,
                    )
                  : addObjectContainer(valuePath, plan);
        if (!valid) {
          plan.invalid = true;
          return;
        }
      }
    }
  }
}

/** Uses an explicit JSX collection prop to retain the source value as a neutral empty array. */
export function inspectJsxAttribute(
  attribute: ts.JsxAttribute,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
  localReturnFunctions: ReadonlyMap<string, RuntimeFunction>,
): void {
  const attributeName = attribute.name.getText();
  const expression =
    attribute.initializer !== undefined && ts.isJsxExpression(attribute.initializer)
      ? attribute.initializer.expression
      : undefined;
  if (expression === undefined || !looksLikeStrongContextCollectionName(attributeName)) return;
  const resolved = readHookBoundValue(
    expression,
    bindings,
    plan.candidate.call,
    localReturnFunctions,
  );
  for (const valuePath of resolved?.paths ?? []) {
    if (!addCollectionLeaf(valuePath, plan)) {
      plan.invalid = true;
      return;
    }
  }
}

/**
 * Recognizes only strong collection conventions when a value crosses an unanalyzed call/JSX edge.
 * Direct built-in Array method calls are handled separately and need no naming inference.
 */
export function looksLikeStrongContextCollectionName(propertyName: string | undefined): boolean {
  if (propertyName === undefined) return false;
  const name = propertyName.replaceAll('_', '').toLowerCase();
  if (
    /(?:address|analysis|business|class|news|options|parameters|params|process|progress|properties|props|series|settings|statistics|status|styles|success|values|variables)$/u.test(
      name,
    )
  ) {
    return false;
  }
  return (
    /(?:items|nodes|edges|rows|records|results|entries|connections|collection|datalist)$/u.test(
      name,
    ) ||
    name.endsWith('ies') ||
    name.endsWith('s')
  );
}
