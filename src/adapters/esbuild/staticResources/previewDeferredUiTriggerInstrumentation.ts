/**
 * Instruments authored JSX event props that expose a deferred, imperative UI branch.
 *
 * React applications commonly keep a modal or drawer outside the linear JSX return path and reveal
 * it through `modal.show()`, `dialog.open()`, or `sheet.present()`. Page Inspector must not execute
 * those calls while analyzing source. Instead, this transform registers inert source metadata at
 * module evaluation and returns the exact authored event-handler function from a runtime registry.
 * The Inspector can then offer an explicit, user-owned activation action after React proves that the
 * handler is still attached to a mounted Fiber.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import {
  canReplayPreviewDeferredUiStateTransition,
  readPreviewDeferredUiHandler,
  readPreviewDeferredUiStateSetter,
} from './previewDeferredUiHandlerScope';
import { createPreviewDeferredUiPropFlowAnalyzer } from './previewDeferredUiPropFlow';
import type { PreviewSourceReplacement } from './previewSourceReplacement';
import {
  createPreviewRuntimeSourceSyntax,
  type PreviewRuntimeSourceSyntax,
} from './previewRuntimeSourceSyntax';

const PREVIEW_INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';
const MAX_DEFERRED_UI_TRIGGERS_PER_MODULE = 64;
const MAX_LOCAL_ALIAS_DEPTH = 4;
const MAX_METADATA_TEXT_LENGTH = 180;
const IMPERATIVE_VISIBILITY_METHODS = new Set([
  'open',
  'openModal',
  'present',
  'presentModal',
  'show',
  'showModal',
]);

/** Serializable evidence retained by the browser without retaining executable project values. */
export interface PreviewDeferredUiTriggerMetadata {
  /** One-based source column of the JSX event-handler expression. */
  readonly column: number;
  /** JSX event prop, such as `onClick`, that owns the callable. */
  readonly eventName: string;
  /** Bounded authored handler expression shown in the component tree. */
  readonly expression: string;
  /** Stable source-derived identity shared by metadata and callable registrations. */
  readonly id: string;
  /** Whether static syntax proves that user activation calls the visibility method with zero args. */
  readonly invocationSafe: boolean;
  /** Distinguishes imperative services from a compiler-proven local React state transition. */
  readonly kind?: 'imperative-visibility' | 'local-state-transition';
  /** One-based source line of the JSX event-handler expression. */
  readonly line: number;
  /** Proven zero-argument visibility method reached by the handler. */
  readonly methodName: string;
  /** Nearest statically named function used to attach the placeholder to the component tree. */
  readonly ownerName?: string;
  /** Local useState value changed by a state-transition trigger. */
  readonly stateName?: string;
  /** Absolute workspace source path used only for local Inspector source navigation. */
  readonly sourcePath: string;
}

/** Output kept separate so the central source transformer can reconcile overlapping edits once. */
export interface PreviewDeferredUiTriggerInstrumentation {
  /** Module-scope inert metadata registrations appended after authored source. */
  readonly registrations: readonly string[];
  /** Handler-expression wrappers that evaluate and return the authored function exactly once. */
  readonly replacements: readonly PreviewSourceReplacement[];
}

/** One event handler proven to reach a supported zero-argument visibility method. */
interface DeferredUiTriggerCandidate {
  readonly activationExpression?: ts.CallExpression;
  readonly expression: ts.Expression;
  readonly metadata: PreviewDeferredUiTriggerMetadata;
}

/** Proven imperative method plus whether the authored event handler supplies a zero-arg contract. */
interface ImperativeVisibilityEvidence {
  readonly activationExpression?: ts.CallExpression;
  readonly invocationSafe: boolean;
  readonly kind?: 'imperative-visibility' | 'local-state-transition';
  readonly methodName: string;
  readonly stateName?: string;
}

/** Traversal context distinguishes a direct function reference from a call inside a safe wrapper. */
type ImperativeHandlerPosition = 'called-alias' | 'event' | 'handler-body';

/**
 * Adds Page-Inspector-only deferred UI registrations to one JavaScript-like source module.
 *
 * The analyzer never resolves imports, evaluates getters, calls functions, or guesses arguments.
 * Unsupported event bodies remain byte-for-byte unchanged.
 */
export function instrumentPreviewDeferredUiTriggers(
  sourcePath: string,
  sourceText: string,
  syntax?: PreviewRuntimeSourceSyntax,
): PreviewDeferredUiTriggerInstrumentation {
  if (!isJavaScriptLikeSource(sourcePath) || !sourceText.includes('on')) {
    return { registrations: [], replacements: [] };
  }
  const sourceFile = (syntax ?? createPreviewRuntimeSourceSyntax()).readSourceFile(
    sourcePath,
    sourceText,
    selectScriptKind(sourcePath),
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0) {
    return { registrations: [], replacements: [] };
  }
  const candidates = collectDeferredUiTriggerCandidates(sourceFile, sourcePath).slice(
    0,
    MAX_DEFERRED_UI_TRIGGERS_PER_MODULE,
  );
  return {
    registrations: candidates.map(({ metadata }) => createMetadataRegistration(metadata)),
    replacements: candidates.map(({ activationExpression, expression, metadata }) => ({
      end: expression.end,
      replacement: createHandlerRegistration(
        expression.getText(sourceFile),
        metadata,
        activationExpression?.getText(sourceFile),
      ),
      start: expression.getStart(sourceFile),
    })),
  };
}

/** Finds JSX `onX` props whose handler reaches one supported zero-argument imperative method. */
function collectDeferredUiTriggerCandidates(
  sourceFile: ts.SourceFile,
  sourcePath: string,
): readonly DeferredUiTriggerCandidate[] {
  const candidates: DeferredUiTriggerCandidate[] = [];
  const propFlowAnalyzer = createPreviewDeferredUiPropFlowAnalyzer(sourceFile);
  /** Visits source order so the bounded inventory remains deterministic across builds. */
  function visit(node: ts.Node): void {
    if (ts.isJsxAttribute(node) && isReactEventAttribute(node)) {
      const initializer = node.initializer;
      const expression =
        initializer !== undefined && ts.isJsxExpression(initializer)
          ? initializer.expression
          : undefined;
      const usePosition = node.getStart(sourceFile);
      const directEvidence =
        expression === undefined
          ? undefined
          : findImperativeVisibilityEvidence(expression, usePosition, new Set(), 0, 'event');
      const stateTransitionEvidence =
        directEvidence !== undefined || expression === undefined
          ? undefined
          : findLocalStateTransitionEvidence(expression, usePosition, new Set(), 0, 'event');
      const evidence =
        directEvidence ??
        stateTransitionEvidence ??
        (expression === undefined ? undefined : propFlowAnalyzer.find(expression));
      if (expression !== undefined && evidence !== undefined) {
        const activationExpression =
          'activationExpression' in evidence ? evidence.activationExpression : undefined;
        if (
          activationExpression === undefined ||
          canReplayPreviewDeferredUiStateTransition(activationExpression, node)
        )
          candidates.push({
            ...(activationExpression === undefined ? {} : { activationExpression }),
            expression,
            metadata: createTriggerMetadata(
              sourceFile,
              sourcePath,
              node.name.getText(sourceFile),
              expression,
              evidence,
            ),
          });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return candidates;
}

/** React event props are case-sensitive and conventionally begin with `on` plus an uppercase name. */
function isReactEventAttribute(node: ts.JsxAttribute): boolean {
  return ts.isIdentifier(node.name) && /^on[A-Z][A-Za-z0-9]*$/u.test(node.name.text);
}

/**
 * Resolves a handler to one visibility method through a bounded local alias chain.
 *
 * Blocks must contain exactly one expression statement or return; functions with parameters are
 * declined because Page Inspector never invents arguments. Direct property references remain inert
 * placeholders because their zero-argument contract cannot be proven from syntax alone.
 */
function findImperativeVisibilityEvidence(
  expression: ts.Expression | ts.FunctionDeclaration,
  usePosition: number,
  visitedAliases: ReadonlySet<string>,
  depth: number,
  position: ImperativeHandlerPosition,
): ImperativeVisibilityEvidence | undefined {
  if (depth > MAX_LOCAL_ALIAS_DEPTH) return undefined;
  const unwrapped = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(unwrapped)) {
    if (
      !IMPERATIVE_VISIBILITY_METHODS.has(unwrapped.name.text) ||
      !hasImperativeUiReceiverEvidence(unwrapped.expression)
    ) {
      return undefined;
    }
    if (position === 'handler-body') return undefined;
    return {
      invocationSafe: position === 'called-alias',
      methodName: unwrapped.name.text,
    };
  }
  if (ts.isCallExpression(unwrapped)) {
    if (position !== 'handler-body' || unwrapped.arguments.length !== 0) return undefined;
    const callee = unwrapExpression(unwrapped.expression);
    if (ts.isIdentifier(callee)) {
      return findImperativeVisibilityEvidence(
        callee,
        usePosition,
        visitedAliases,
        depth + 1,
        'called-alias',
      );
    }
    return ts.isPropertyAccessExpression(callee) &&
      IMPERATIVE_VISIBILITY_METHODS.has(callee.name.text) &&
      hasImperativeUiReceiverEvidence(callee.expression)
      ? { invocationSafe: true, methodName: callee.name.text }
      : undefined;
  }
  if (ts.isIdentifier(unwrapped)) {
    if (visitedAliases.has(unwrapped.text)) return undefined;
    const alias = readPreviewDeferredUiHandler(unwrapped, usePosition);
    if (alias === undefined) return undefined;
    const nextVisited = new Set(visitedAliases);
    nextVisited.add(unwrapped.text);
    return findImperativeVisibilityEvidence(alias, usePosition, nextVisited, depth + 1, position);
  }
  if (
    (ts.isArrowFunction(unwrapped) ||
      ts.isFunctionExpression(unwrapped) ||
      ts.isFunctionDeclaration(unwrapped)) &&
    unwrapped.parameters.length === 0 &&
    unwrapped.body !== undefined
  ) {
    const bodyExpression = readSingleFunctionBodyExpression(unwrapped.body);
    return bodyExpression === undefined
      ? undefined
      : findImperativeVisibilityEvidence(
          bodyExpression,
          usePosition,
          visitedAliases,
          depth + 1,
          'handler-body',
        );
  }
  return undefined;
}

/** Accepts a non-null value that can reveal a locally state-gated UI without evaluating it now. */
function isPositiveLocalStateTransitionArgument(expression: ts.Expression): boolean {
  const value = unwrapExpression(expression);
  if (value.kind === ts.SyntaxKind.NullKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (ts.isIdentifier(value)) return value.text !== 'undefined';
  if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text.length > 0;
  }
  if (ts.isNumericLiteral(value)) return Number(value.text) !== 0;
  return value.kind === ts.SyntaxKind.TrueKeyword;
}

/** Restricts an authored short-circuit prefix to side-effect-free scalar reads. */
function isSafeLocalStateTransitionGuard(expression: ts.Expression, depth = 0): boolean {
  if (depth > 8) return false;
  const value = unwrapExpression(expression);
  if (
    ts.isIdentifier(value) ||
    ts.isPropertyAccessExpression(value) ||
    ts.isElementAccessExpression(value) ||
    ts.isLiteralExpression(value) ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword
  )
    return true;
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) {
    return isSafeLocalStateTransitionGuard(value.operand, depth + 1);
  }
  if (!ts.isBinaryExpression(value)) return false;
  const safeOperators = new Set([
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken,
    ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.LessThanEqualsToken,
  ]);
  return (
    safeOperators.has(value.operatorToken.kind) &&
    isSafeLocalStateTransitionGuard(value.left, depth + 1) &&
    isSafeLocalStateTransitionGuard(value.right, depth + 1)
  );
}

/** Finds one positive useState setter call behind optional Boolean event guards. */
function findLocalStateTransitionCall(
  expression: ts.Expression,
  usePosition: number,
  depth = 0,
): ImperativeVisibilityEvidence | undefined {
  if (depth > 8) return undefined;
  const value = unwrapExpression(expression);
  if (ts.isCallExpression(value)) {
    const callee = unwrapExpression(value.expression);
    const stateName = ts.isIdentifier(callee)
      ? readPreviewDeferredUiStateSetter(callee, usePosition)
      : undefined;
    const argument = value.arguments[0];
    return stateName !== undefined &&
      value.arguments.length === 1 &&
      argument !== undefined &&
      isPositiveLocalStateTransitionArgument(argument)
      ? {
          activationExpression: value,
          invocationSafe: true,
          kind: 'local-state-transition',
          methodName: (callee as ts.Identifier).text,
          stateName,
        }
      : undefined;
  }
  if (
    !ts.isBinaryExpression(value) ||
    value.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken ||
    !isSafeLocalStateTransitionGuard(value.left)
  )
    return undefined;
  return findLocalStateTransitionCall(value.right, usePosition, depth + 1);
}

/** Follows the same immutable handler aliases while retaining the exact setter call for replay. */
function findLocalStateTransitionEvidence(
  expression: ts.Expression | ts.FunctionDeclaration,
  usePosition: number,
  visitedAliases: ReadonlySet<string>,
  depth: number,
  position: ImperativeHandlerPosition,
): ImperativeVisibilityEvidence | undefined {
  if (depth > MAX_LOCAL_ALIAS_DEPTH) return undefined;
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) {
    if (visitedAliases.has(value.text)) return undefined;
    const alias = readPreviewDeferredUiHandler(value, usePosition);
    if (alias === undefined) return undefined;
    const nextVisited = new Set(visitedAliases);
    nextVisited.add(value.text);
    return findLocalStateTransitionEvidence(alias, usePosition, nextVisited, depth + 1, position);
  }
  if (
    (ts.isArrowFunction(value) ||
      ts.isFunctionExpression(value) ||
      ts.isFunctionDeclaration(value)) &&
    value.parameters.length === 0 &&
    value.body !== undefined
  ) {
    const bodyExpression = readSingleFunctionBodyExpression(value.body);
    return bodyExpression === undefined
      ? undefined
      : findLocalStateTransitionCall(bodyExpression, usePosition);
  }
  if (position === 'called-alias' && ts.isCallExpression(value)) {
    return findLocalStateTransitionCall(value, usePosition);
  }
  return undefined;
}

/**
 * Requires a UI-shaped receiver name before treating generic methods such as open/show as visual.
 * This excludes unrelated domain calls like billing.show() while retaining modalRef.current.open().
 */
function hasImperativeUiReceiverEvidence(expression: ts.Expression): boolean {
  const names: string[] = [];
  let current = unwrapExpression(expression);
  while (ts.isPropertyAccessExpression(current)) {
    names.push(current.name.text);
    current = unwrapExpression(current.expression);
  }
  if (ts.isIdentifier(current)) names.push(current.text);
  return names.some((name) => {
    const lowerName = name.toLowerCase();
    if (lowerName === 'action' || lowerName === 'actions' || lowerName === 'ref') return true;
    return ['dialog', 'drawer', 'modal', 'overlay', 'popover', 'sheet'].some((token) =>
      lowerName.includes(token),
    );
  });
}

/** Returns the only expression executed by a safe local handler body. */
function readSingleFunctionBodyExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) return body;
  if (body.statements.length !== 1) return undefined;
  const statement = body.statements[0];
  if (statement === undefined) return undefined;
  if (ts.isExpressionStatement(statement)) return statement.expression;
  return ts.isReturnStatement(statement) ? statement.expression : undefined;
}

/** Removes type-only and parenthesized syntax while preserving the runtime expression identity. */
function unwrapExpression(
  value: ts.Expression | ts.FunctionDeclaration,
): ts.Expression | ts.FunctionDeclaration {
  let current = value;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Creates bounded metadata without exposing the full source module to the browser UI. */
function createTriggerMetadata(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  eventName: string,
  expression: ts.Expression,
  evidence: ImperativeVisibilityEvidence,
): PreviewDeferredUiTriggerMetadata {
  const position = sourceFile.getLineAndCharacterOfPosition(expression.getStart(sourceFile));
  const ownerName = findNearestNamedFunction(expression);
  const identity = [
    sourcePath,
    expression.getStart(sourceFile),
    eventName,
    evidence.kind ?? 'imperative-visibility',
    evidence.methodName,
    evidence.stateName ?? '',
  ].join('\0');
  return {
    column: position.character + 1,
    eventName: eventName.slice(0, MAX_METADATA_TEXT_LENGTH),
    expression: expression.getText(sourceFile).trim().slice(0, MAX_METADATA_TEXT_LENGTH),
    id: `deferred-ui:${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`,
    invocationSafe: evidence.invocationSafe,
    ...(evidence.kind === undefined ? {} : { kind: evidence.kind }),
    line: position.line + 1,
    methodName: evidence.methodName,
    ...(ownerName === undefined ? {} : { ownerName }),
    ...(evidence.stateName === undefined ? {} : { stateName: evidence.stateName }),
    sourcePath: path.normalize(sourcePath),
  };
}

/** Finds the nearest named function, variable-owned function, or class method for tree ownership. */
function findNearestNamedFunction(node: ts.Node): string | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) &&
      current.name !== undefined
    ) {
      return current.name.text;
    }
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return undefined;
}

/** Wraps one handler expression while evaluating it once and returning the same function object. */
function createHandlerRegistration(
  expressionText: string,
  metadata: PreviewDeferredUiTriggerMetadata,
  activationExpressionText?: string,
): string {
  const api = `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
  const serialized = JSON.stringify(metadata);
  const activation =
    activationExpressionText === undefined ? '' : `, () => (${activationExpressionText})`;
  return `((__reactPreviewDeferredUiHandler) => { try { ${api}?.registerDeferredUiTrigger?.(__reactPreviewDeferredUiHandler, ${serialized}${activation}); } catch { /* Preserve authored event semantics. */ } return __reactPreviewDeferredUiHandler; })(${expressionText})`;
}

/** Registers inert source evidence without constructing or invoking the authored handler. */
function createMetadataRegistration(metadata: PreviewDeferredUiTriggerMetadata): string {
  const api = `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
  return `try { ${api}?.registerDeferredUiTriggerMetadata?.(${JSON.stringify(metadata)}); } catch { /* Inspector registration must not break the authored module. */ }`;
}

/** Selects TypeScript parser grammar from a supported JavaScript-like extension. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** Prevents markup/configuration files from entering TypeScript's recovery parser. */
function isJavaScriptLikeSource(sourcePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/iu.test(sourcePath);
}
