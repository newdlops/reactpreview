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
import type { PreviewSourceReplacement } from './previewSourceReplacement';

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
  /** One-based source line of the JSX event-handler expression. */
  readonly line: number;
  /** Proven zero-argument visibility method reached by the handler. */
  readonly methodName: string;
  /** Nearest statically named function used to attach the placeholder to the component tree. */
  readonly ownerName?: string;
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
  readonly expression: ts.Expression;
  readonly metadata: PreviewDeferredUiTriggerMetadata;
}

/** Proven imperative method plus whether the authored event handler supplies a zero-arg contract. */
interface ImperativeVisibilityEvidence {
  readonly invocationSafe: boolean;
  readonly methodName: string;
}

/** Traversal context distinguishes a direct function reference from a call inside a safe wrapper. */
type ImperativeHandlerPosition = 'called-alias' | 'event' | 'handler-body';

/** Local declarations used only to follow short, side-effect-free handler alias chains. */
type LocalHandlerDeclaration =
  | ts.ArrowFunction
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.Identifier
  | ts.PropertyAccessExpression;

/** Expression-only subset accepted directly from one variable initializer. */
type LocalHandlerExpression = Exclude<LocalHandlerDeclaration, ts.FunctionDeclaration>;

/**
 * Adds Page-Inspector-only deferred UI registrations to one JavaScript-like source module.
 *
 * The analyzer never resolves imports, evaluates getters, calls functions, or guesses arguments.
 * Unsupported event bodies remain byte-for-byte unchanged.
 */
export function instrumentPreviewDeferredUiTriggers(
  sourcePath: string,
  sourceText: string,
): PreviewDeferredUiTriggerInstrumentation {
  if (!isJavaScriptLikeSource(sourcePath) || !sourceText.includes('on')) {
    return { registrations: [], replacements: [] };
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
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
    replacements: candidates.map(({ expression, metadata }) => ({
      end: expression.end,
      replacement: createHandlerRegistration(expression.getText(sourceFile), metadata),
      start: expression.getStart(sourceFile),
    })),
  };
}

/** Restricts aliases to syntax whose eventual call target can be inspected without evaluation. */
function isSupportedLocalHandlerDeclaration(node: ts.Expression): node is LocalHandlerExpression {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node)
  );
}

/** Finds JSX `onX` props whose handler reaches one supported zero-argument imperative method. */
function collectDeferredUiTriggerCandidates(
  sourceFile: ts.SourceFile,
  sourcePath: string,
): readonly DeferredUiTriggerCandidate[] {
  const candidates: DeferredUiTriggerCandidate[] = [];
  /** Visits source order so the bounded inventory remains deterministic across builds. */
  function visit(node: ts.Node): void {
    if (ts.isJsxAttribute(node) && isReactEventAttribute(node)) {
      const initializer = node.initializer;
      const expression =
        initializer !== undefined && ts.isJsxExpression(initializer)
          ? initializer.expression
          : undefined;
      const evidence =
        expression === undefined
          ? undefined
          : findImperativeVisibilityEvidence(
              expression,
              collectVisibleLocalHandlerDeclarations(node, sourceFile),
              new Set(),
              0,
              'event',
            );
      if (expression !== undefined && evidence !== undefined) {
        candidates.push({
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

/**
 * Collects aliases only from lexical statement scopes enclosing the JSX attribute.
 *
 * Module scope is applied first and inner blocks replace outer names. Sibling blocks are never
 * searched, and variable aliases declared after the JSX expression are excluded. This intentionally
 * sacrifices uncommon control-flow aliases to prevent similarly named handlers in another component
 * from being registered against the wrong event.
 */
function collectVisibleLocalHandlerDeclarations(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, LocalHandlerDeclaration> {
  const scopes: readonly ts.NodeArray<ts.Statement>[] = [sourceFile.statements];
  const nestedScopes: ts.NodeArray<ts.Statement>[] = [];
  let current = node.parent;
  while (current !== sourceFile) {
    if (ts.isBlock(current)) nestedScopes.push(current.statements);
    current = current.parent;
  }
  const aliases = new Map<string, LocalHandlerDeclaration>();
  for (const statements of [...scopes, ...nestedScopes.reverse()]) {
    const localAliases = collectDirectStatementAliases(statements, node.getStart(sourceFile));
    for (const [name, declaration] of localAliases) aliases.set(name, declaration);
  }
  return aliases;
}

/** Collects unique direct declarations from one lexical block without descending into siblings. */
function collectDirectStatementAliases(
  statements: readonly ts.Statement[],
  usePosition: number,
): ReadonlyMap<string, LocalHandlerDeclaration> {
  const aliases = new Map<string, LocalHandlerDeclaration>();
  const ambiguousNames = new Set<string>();
  const reassignedNames = collectPotentiallyReassignedNames(statements);
  const admit = (name: string, declaration: LocalHandlerDeclaration): void => {
    if (aliases.has(name)) {
      aliases.delete(name);
      ambiguousNames.add(name);
    } else if (!ambiguousNames.has(name)) {
      aliases.set(name, declaration);
    }
  };
  for (const statement of statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      !reassignedNames.has(statement.name.text)
    ) {
      admit(statement.name.text, statement);
      continue;
    }
    if (
      !ts.isVariableStatement(statement) ||
      statement.getStart() >= usePosition ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer !== undefined &&
        isSupportedLocalHandlerDeclaration(declaration.initializer)
      ) {
        admit(declaration.name.text, declaration.initializer);
      }
    }
  }
  return aliases;
}

/**
 * Finds writes that can replace a function declaration before or after JSX is evaluated.
 *
 * Function declarations are mutable JavaScript bindings, so a source-shaped body alone does not
 * prove which closure an event prop will receive. This deliberately scans the complete lexical
 * statement list and treats nested writes conservatively. False negatives only leave a dormant UI
 * path undiscovered; a false positive could authorize the wrong project function.
 */
function collectPotentiallyReassignedNames(
  statements: readonly ts.Statement[],
): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      collectAssignedIdentifierNames(node.left, names);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      collectAssignedIdentifierNames(node.operand, names);
    } else if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    ) {
      collectAssignedIdentifierNames(node.initializer, names);
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of statements) visit(statement);
  return names;
}

/** Collects local binding names written by one assignment or destructuring target. */
function collectAssignedIdentifierNames(node: ts.Expression, names: Set<string>): void {
  const target = unwrapExpression(node);
  if (ts.isFunctionDeclaration(target)) return;
  if (ts.isIdentifier(target)) {
    names.add(target.text);
    return;
  }
  if (
    ts.isBinaryExpression(target) &&
    target.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    target.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    collectAssignedIdentifierNames(target.left, names);
    return;
  }
  if (ts.isArrayLiteralExpression(target)) {
    for (const element of target.elements) {
      if (ts.isOmittedExpression(element)) continue;
      collectAssignedIdentifierNames(
        ts.isSpreadElement(element) ? element.expression : element,
        names,
      );
    }
    return;
  }
  if (!ts.isObjectLiteralExpression(target)) return;
  for (const property of target.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      names.add(property.name.text);
    } else if (ts.isPropertyAssignment(property)) {
      collectAssignedIdentifierNames(property.initializer, names);
    } else if (ts.isSpreadAssignment(property)) {
      collectAssignedIdentifierNames(property.expression, names);
    }
  }
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
  aliases: ReadonlyMap<string, LocalHandlerDeclaration>,
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
        aliases,
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
    const alias = aliases.get(unwrapped.text);
    if (alias === undefined) return undefined;
    const nextVisited = new Set(visitedAliases);
    nextVisited.add(unwrapped.text);
    return findImperativeVisibilityEvidence(alias, aliases, nextVisited, depth + 1, position);
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
          aliases,
          visitedAliases,
          depth + 1,
          'handler-body',
        );
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
    evidence.methodName,
  ].join('\0');
  return {
    column: position.character + 1,
    eventName: eventName.slice(0, MAX_METADATA_TEXT_LENGTH),
    expression: expression.getText(sourceFile).trim().slice(0, MAX_METADATA_TEXT_LENGTH),
    id: `deferred-ui:${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`,
    invocationSafe: evidence.invocationSafe,
    line: position.line + 1,
    methodName: evidence.methodName,
    ...(ownerName === undefined ? {} : { ownerName }),
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
): string {
  const api = `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
  const serialized = JSON.stringify(metadata);
  return `((__reactPreviewDeferredUiHandler) => { try { ${api}?.registerDeferredUiTrigger?.(__reactPreviewDeferredUiHandler, ${serialized}); } catch { /* Preserve authored event semantics. */ } return __reactPreviewDeferredUiHandler; })(${expressionText})`;
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
