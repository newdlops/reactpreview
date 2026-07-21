/**
 * Instruments JSX-bearing boolean conditions for the React Page Inspector.
 *
 * The transform never evaluates project expressions and replaces only the condition operand. With no
 * user override the browser runtime returns the authored value unchanged, preserving JavaScript's
 * original truthiness and `&&` result semantics. Forced states return a boolean only when required to
 * reveal or hide a branch in the static preview.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import {
  applyPreviewReactConditionalReplacements,
  selectOutermostPreviewReactConditionalReplacements,
  type PreviewReactConditionalReplacement,
} from './previewReactConditionalReplacements';
import { expandPreviewReactLogicalAndExpression } from './previewReactLogicalAnd';
import { createPreviewRenderExpressionFingerprint } from './previewReactRenderOutcomeSyntax';
import {
  createPreviewReactRenderTerminalAnalyzer,
  isPreviewReactCreateElementCall,
  type PreviewReactRenderTerminalEvidence,
} from './previewReactRenderTerminal';
import { instrumentReactArrayIndexRendering } from './reactArrayIndexRendering';
import { instrumentReactSwitchRendering } from './reactSwitchRendering';

const MAX_CONDITIONS_PER_MODULE = 128;
const MAX_METADATA_TEXT_LENGTH = 180;
const PREVIEW_INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';
const OVERLAY_COMPONENT_NAME_PATTERN =
  /(?:modal|dialog|drawer|popover|popper|overlay|portal|sheet|lightbox|tooltip|toast|dropdown|menu)$/iu;
const POSITIVE_OVERLAY_VISIBILITY_PROPS = new Set([
  'active',
  'defaultopen',
  'defaultvisible',
  'expanded',
  'isopen',
  'isvisible',
  'open',
  'present',
  'show',
  'shown',
  'visible',
]);
const NEGATIVE_OVERLAY_VISIBILITY_PROPS = new Set(['hidden', 'ishidden']);

/** Imported ReactDOM identities that statically prove a createPortal render expression. */
interface ReactDomPortalBindings {
  readonly direct: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
}

/** Function scopes whose own overlay guard may safely become a visibility control. */
type OverlayRuntimeFunction =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;

/** Serializable browser metadata used to label and locate one conditional tree entry. */
interface ReactConditionalRenderMetadata {
  /** Bounded authored expression used for display and legacy static-outcome joins. */
  readonly authoredExpression: string;
  /** Whether runtime true means the opposite of the authored condition branch. */
  readonly authoredExpressionNegated?: boolean;
  /** One-based source column of the condition expression. */
  readonly column: number;
  /** Bounded human-readable condition source. */
  readonly expression: string;
  /** SHA-256 of the complete trimmed authored expression used for hot-edit-safe joins. */
  readonly expressionFingerprint: string;
  /** Branch that appears to be an authored fallback, when its component name is explicit. */
  readonly fallbackBranch?: 'falsy' | 'truthy';
  /** Label rendered when the condition resolves false. */
  readonly falsyLabel: string;
  /** Supported syntax family. */
  readonly kind: 'early-return' | 'logical-and' | 'overlay-visibility' | 'ternary';
  /** One-based source line of the condition expression. */
  readonly line: number;
  /** Absolute source identity retained inside the local webview. */
  readonly sourcePath: string;
  /** Nearest statically named render owner, used to attach a blocker to its tree position. */
  readonly ownerName?: string;
  /** Optional visual-layer classification used for dormant overlay controls. */
  readonly role?: 'overlay';
  /** Branch that continues toward the selected descendant after an early render exit. */
  readonly targetBranch?: 'falsy' | 'truthy';
  /** Label rendered when the condition resolves true. */
  readonly truthyLabel: string;
}

/** Parsed condition candidate before a stable runtime identity and replacement are generated. */
interface ReactConditionalRenderCandidate {
  /** Authored expression whose truthiness selects the JSX branch. */
  readonly condition: ts.Expression;
  /** Readable JSX attribute label used instead of repeating only its value expression. */
  readonly expressionLabel?: string;
  /** Static labels and source data exposed in the Inspector. */
  readonly metadata: Omit<
    ReactConditionalRenderMetadata,
    | 'authoredExpression'
    | 'authoredExpressionNegated'
    | 'column'
    | 'expression'
    | 'expressionFingerprint'
    | 'line'
    | 'sourcePath'
  >;
  /** Whether a negative prop such as `hidden` must invert the visible-state resolver result. */
  readonly negateRuntimeResult?: boolean;
}

/**
 * Adds Page Inspector resolver calls to JSX-bearing `condition && child` and ternary expressions.
 *
 * Parse recovery fails closed, non-JSX boolean operations remain byte-for-byte intact, and a bounded
 * per-module inventory prevents generated application code from producing an unbounded Inspector UI.
 *
 * @param sourcePath Absolute workspace source path used for identity and parser grammar.
 * @param sourceText Source after other non-overlapping compatibility rewrites have completed.
 * @returns Instrumented source, or the original source when no supported condition was proven.
 */
export function instrumentReactConditionalRendering(
  sourcePath: string,
  sourceText: string,
): string {
  if (!isJavaScriptLikeSource(sourcePath)) {
    return sourceText;
  }
  const arrayInstrumentedSource = instrumentReactArrayIndexRendering(sourcePath, sourceText);
  const switchInstrumentedSource = instrumentReactSwitchRendering(
    sourcePath,
    arrayInstrumentedSource,
  );
  if (!mayContainConditionalJsx(switchInstrumentedSource)) return switchInstrumentedSource;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    switchInstrumentedSource,
    ts.ScriptTarget.Latest,
    true,
    selectConditionalScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return switchInstrumentedSource;
  }

  const candidates = collectConditionalRenderCandidates(
    sourceFile,
    collectReactDomPortalBindings(sourceFile),
  ).slice(0, MAX_CONDITIONS_PER_MODULE);
  const replacements = selectOutermostPreviewReactConditionalReplacements(
    candidates.map((candidate, index) =>
      createConditionalRenderReplacement(sourceFile, sourcePath, candidate, index),
    ),
  );
  return applyPreviewReactConditionalReplacements(switchInstrumentedSource, replacements);
}

/** Collects only boolean expressions whose selected branch directly renders JSX. */
function collectConditionalRenderCandidates(
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): readonly ReactConditionalRenderCandidate[] {
  const candidates: ReactConditionalRenderCandidate[] = [];
  const logicalGuardRanges = new Set<string>();
  const terminalAnalyzer = createPreviewReactRenderTerminalAnalyzer(sourceFile, {
    isAdditionalTerminal: (expression) =>
      isReactDomPortalCall(expression, portalBindings) || isJsxRouteEntryExpression(expression),
  });
  /** Visits syntax in source order while retaining nested independent branch controls. */
  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      candidates.push(...collectOverlayVisibilityCandidates(node, sourceFile));
    }
    if (ts.isIfStatement(node)) {
      const overlayGuard = collectOverlayNullGuardCandidate(node, sourceFile, portalBindings);
      if (overlayGuard !== undefined) {
        candidates.push(overlayGuard);
      } else {
        const earlyReturnGate = collectEarlyReturnGateCandidate(node, sourceFile, portalBindings);
        if (earlyReturnGate !== undefined) candidates.push(earlyReturnGate);
      }
    }
    const logicalAnd =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        ? expandPreviewReactLogicalAndExpression(node)
        : undefined;
    const terminalEvidence =
      logicalAnd === undefined ? undefined : terminalAnalyzer.analyze(logicalAnd.terminal);
    const hasRuntimeFunction = findNearestOverlayRuntimeFunction(node) !== undefined;
    if (logicalAnd !== undefined && terminalEvidence !== undefined && hasRuntimeFunction) {
      const truthyLabel = describeRenderTerminalEvidence(
        terminalEvidence,
        sourceFile,
        portalBindings,
      );
      const role = terminalEvidence.terminals.some((terminal) =>
        isOverlayReactRenderExpression(terminal, sourceFile, portalBindings),
      )
        ? ('overlay' as const)
        : undefined;
      for (const condition of logicalAnd.guards) {
        const rangeKey = [condition.getStart(sourceFile), condition.end].join(':');
        if (logicalGuardRanges.has(rangeKey)) continue;
        logicalGuardRanges.add(rangeKey);
        candidates.push({
          condition,
          metadata: {
            falsyLabel: 'hidden',
            kind: 'logical-and',
            ...(role === undefined ? {} : { role }),
            truthyLabel,
          },
        });
      }
    } else if (ts.isConditionalExpression(node) && hasRuntimeFunction) {
      const truthyEvidence = terminalAnalyzer.analyze(node.whenTrue);
      const falsyEvidence = terminalAnalyzer.analyze(node.whenFalse);
      if (truthyEvidence !== undefined || falsyEvidence !== undefined) {
        const truthyLabel =
          truthyEvidence === undefined
            ? describeRenderBranch(node.whenTrue, sourceFile, portalBindings)
            : describeRenderTerminalEvidence(truthyEvidence, sourceFile, portalBindings);
        const falsyLabel =
          falsyEvidence === undefined
            ? describeRenderBranch(node.whenFalse, sourceFile, portalBindings)
            : describeRenderTerminalEvidence(falsyEvidence, sourceFile, portalBindings);
        const hasOverlayTerminal = [
          ...(truthyEvidence?.terminals ?? []),
          ...(falsyEvidence?.terminals ?? []),
        ].some((terminal) => isOverlayReactRenderExpression(terminal, sourceFile, portalBindings));
        candidates.push({
          condition: node.condition,
          metadata: {
            ...inferFallbackBranch(truthyLabel, falsyLabel),
            falsyLabel,
            kind: 'ternary',
            ...(hasOverlayTerminal ? { role: 'overlay' as const } : {}),
            truthyLabel,
          },
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return candidates;
}

/**
 * Converts a component-local early render exit into a target-reachability gate.
 *
 * A login, permission, loading, or empty-state component can commit successfully while preventing
 * every statement below it from mounting. Runtime error boundaries cannot observe that situation,
 * so this bounded transform records which branch must be taken to continue the authored component.
 * Only a single direct JSX/null return is admitted; general control flow remains untouched.
 */
function collectEarlyReturnGateCandidate(
  statement: ts.IfStatement,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): ReactConditionalRenderCandidate | undefined {
  const owner = findNearestOverlayRuntimeFunction(statement);
  const ownerName =
    owner === undefined ? undefined : readOverlayRuntimeFunctionName(owner, sourceFile);
  if (ownerName === undefined || !/^[$_\p{Lu}]/u.test(ownerName)) return undefined;
  const thenRender = readSingleReturnedRenderExpression(statement.thenStatement, portalBindings);
  const elseRender =
    statement.elseStatement === undefined
      ? undefined
      : readSingleReturnedRenderExpression(statement.elseStatement, portalBindings);
  if (thenRender === undefined && elseRender === undefined) return undefined;
  if (thenRender !== undefined && elseRender !== undefined) {
    const truthyLabel = describeReturnedRenderExpression(thenRender, sourceFile, portalBindings);
    const falsyLabel = describeReturnedRenderExpression(elseRender, sourceFile, portalBindings);
    return {
      condition: statement.expression,
      expressionLabel: `<${ownerName}> branch: ${statement.expression.getText(sourceFile)}`,
      metadata: {
        ...inferFallbackBranch(truthyLabel, falsyLabel),
        falsyLabel,
        kind: 'early-return',
        ownerName,
        truthyLabel,
      },
    };
  }
  const returnedBranch = thenRender === undefined ? 'falsy' : 'truthy';
  const targetBranch = returnedBranch === 'truthy' ? 'falsy' : 'truthy';
  const returnedLabel = describeReturnedRenderExpression(
    thenRender ?? elseRender,
    sourceFile,
    portalBindings,
  );
  const continuationLabel = `continue <${ownerName}>`;
  return {
    condition: statement.expression,
    expressionLabel: `<${ownerName}> gate: ${statement.expression.getText(sourceFile)}`,
    metadata: {
      fallbackBranch: returnedBranch,
      falsyLabel: returnedBranch === 'falsy' ? returnedLabel : continuationLabel,
      kind: 'early-return',
      ownerName,
      targetBranch,
      truthyLabel: returnedBranch === 'truthy' ? returnedLabel : continuationLabel,
    },
  };
}

/** Labels a proven returned render expression consistently for one-sided and two-sided branches. */
function describeReturnedRenderExpression(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): string {
  if (expression?.kind === ts.SyntaxKind.NullKeyword) return 'empty return';
  return expression === undefined
    ? 'early return'
    : describeRenderBranch(expression, sourceFile, portalBindings);
}

/** Reads an exact one-statement return whose value is JSX, a portal, or `null`. */
function readSingleReturnedRenderExpression(
  statement: ts.Statement,
  portalBindings: ReactDomPortalBindings,
): ts.Expression | undefined {
  if (ts.isBlock(statement)) {
    if (statement.statements.length !== 1) return undefined;
    const onlyStatement = statement.statements[0];
    return onlyStatement === undefined
      ? undefined
      : readSingleReturnedRenderExpression(onlyStatement, portalBindings);
  }
  if (!ts.isReturnStatement(statement) || statement.expression === undefined) return undefined;
  const expression = unwrapConditionalExpression(statement.expression);
  return expression.kind === ts.SyntaxKind.NullKeyword ||
    isDirectReactRenderExpression(expression, portalBindings)
    ? expression
    : undefined;
}

/**
 * Converts an overlay component's early `return null` guard into visible-state semantics.
 * A true hidden guard is inverted around the resolver, so an absent override still follows the
 * authored branch while the Inspector consistently exposes true=visible and false=dormant.
 */
function collectOverlayNullGuardCandidate(
  statement: ts.IfStatement,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): ReactConditionalRenderCandidate | undefined {
  const thenHidden = statementReturnsNull(statement.thenStatement);
  const elseHidden =
    statement.elseStatement !== undefined && statementReturnsNull(statement.elseStatement);
  if (thenHidden === elseHidden) return undefined;
  const owner = findNearestOverlayRuntimeFunction(statement);
  if (owner === undefined || !isOverlayRuntimeFunction(owner, sourceFile, portalBindings)) {
    return undefined;
  }
  const ownerName = readOverlayRuntimeFunctionName(owner, sourceFile) ?? 'Overlay';
  return {
    condition: statement.expression,
    expressionLabel: `<${ownerName}> visibility: ${statement.expression.getText(sourceFile)}`,
    metadata: {
      falsyLabel: `hidden <${ownerName}> overlay`,
      kind: 'overlay-visibility',
      ownerName,
      role: 'overlay',
      truthyLabel: `visible <${ownerName}> overlay`,
    },
    ...(thenHidden ? { negateRuntimeResult: true } : {}),
  };
}

/** Recognizes a direct or single-block null return without interpreting control flow. */
function statementReturnsNull(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement))
    return statement.expression?.kind === ts.SyntaxKind.NullKeyword;
  if (!ts.isBlock(statement) || statement.statements.length !== 1) return false;
  const onlyStatement = statement.statements[0];
  return onlyStatement !== undefined && statementReturnsNull(onlyStatement);
}

/** Finds the render-time owner of an early-return guard without crossing another function. */
function findNearestOverlayRuntimeFunction(node: ts.Node): OverlayRuntimeFunction | undefined {
  let current = (node as unknown as { readonly parent?: ts.Node }).parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

/** Requires an overlay-shaped function name or an exact createPortal call in its own body. */
function isOverlayRuntimeFunction(
  owner: OverlayRuntimeFunction,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): boolean {
  const ownerName = readOverlayRuntimeFunctionName(owner, sourceFile);
  if (ownerName !== undefined && OVERLAY_COMPONENT_NAME_PATTERN.test(ownerName)) return true;
  if (owner.body === undefined) return false;
  let portalFound = false;
  const visit = (node: ts.Node): void => {
    if (portalFound || (node !== owner && ts.isFunctionLike(node))) return;
    if (ts.isCallExpression(node) && isReactDomPortalCall(node, portalBindings)) {
      portalFound = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(owner.body);
  return portalFound;
}

/** Reads a declaration, variable, assignment, or method name without resolving project values. */
function readOverlayRuntimeFunctionName(
  owner: OverlayRuntimeFunction,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (owner.name !== undefined) return owner.name.getText(sourceFile);
  let current: ts.Node = owner;
  for (let depth = 0; depth < 8 && !ts.isSourceFile(current.parent); depth += 1) {
    const parent = current.parent;
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === current &&
      ts.isIdentifier(parent.name)
    ) {
      return parent.name.text;
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
      return parent.name.getText(sourceFile);
    }
    if (!isTransparentComponentFactoryWrapper(parent, current)) break;
    current = parent;
  }
  return undefined;
}

/**
 * Admits syntax-only HOC/styling wrappers between a render function and its authored binding.
 *
 * Common components are declared as `const Page = styled(() => ...)\`...\``,
 * `const Page = memo(() => ...)`, or nested factory calls. Walking only an argument, callee tag, or
 * syntax wrapper cannot cross into unrelated control flow, while recovering the name required to
 * attach an early-return condition to the root-to-target component path.
 */
function isTransparentComponentFactoryWrapper(parent: ts.Node, child: ts.Node): boolean {
  if (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeAssertionExpression(parent)
  ) {
    return parent.expression === child;
  }
  if (ts.isCallExpression(parent)) {
    return parent.arguments.includes(child as ts.Expression);
  }
  return ts.isTaggedTemplateExpression(parent) && parent.tag === child;
}

/** Collects explicit controlled visibility props from conventionally named overlay JSX tags. */
function collectOverlayVisibilityCandidates(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
): readonly ReactConditionalRenderCandidate[] {
  const tagName = element.tagName.getText(sourceFile);
  if (!tagName.split('.').some((segment) => OVERLAY_COMPONENT_NAME_PATTERN.test(segment))) {
    return [];
  }
  const candidates: ReactConditionalRenderCandidate[] = [];
  const ownerName = tagName.split('.').at(-1) ?? tagName;
  for (const property of element.attributes.properties) {
    if (!ts.isJsxAttribute(property)) continue;
    const propName = property.name.getText(sourceFile);
    const normalizedPropName = propName.replace(/[-_]/gu, '').toLowerCase();
    const positive = POSITIVE_OVERLAY_VISIBILITY_PROPS.has(normalizedPropName);
    const negative = NEGATIVE_OVERLAY_VISIBILITY_PROPS.has(normalizedPropName);
    const initializer = property.initializer;
    if (
      (!positive && !negative) ||
      initializer === undefined ||
      !ts.isJsxExpression(initializer) ||
      initializer.expression === undefined
    ) {
      continue;
    }
    const authoredExpression = initializer.expression.getText(sourceFile);
    candidates.push({
      condition: initializer.expression,
      expressionLabel: `<${tagName}>.${propName}: ${authoredExpression}`,
      metadata: {
        falsyLabel: `hidden <${tagName}> overlay`,
        kind: 'overlay-visibility',
        ownerName,
        role: 'overlay',
        truthyLabel: `visible <${tagName}> overlay`,
      },
      ...(negative ? { negateRuntimeResult: true } : {}),
    });
  }
  return candidates;
}

/** Collects direct and namespace createPortal imports from the browser ReactDOM package. */
function collectReactDomPortalBindings(sourceFile: ts.SourceFile): ReactDomPortalBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react-dom' ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name !== undefined) namespaces.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    } else if (bindings !== undefined) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'createPortal') {
          direct.add(element.name.text);
        }
      }
    }
  }
  return { direct, namespaces };
}

/** Creates a stable resolver call without evaluating or duplicating the authored expression. */
function createConditionalRenderReplacement(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  candidate: ReactConditionalRenderCandidate,
  occurrence: number,
): PreviewReactConditionalReplacement {
  const start = candidate.condition.getStart(sourceFile);
  const end = candidate.condition.end;
  const authoredExpression = sourceFile.text.slice(start, end);
  const location = sourceFile.getLineAndCharacterOfPosition(start);
  const runtimeOwner = findNearestOverlayRuntimeFunction(candidate.condition);
  const ownerName =
    runtimeOwner === undefined
      ? undefined
      : readOverlayRuntimeFunctionName(runtimeOwner, sourceFile);
  const metadata: ReactConditionalRenderMetadata = {
    authoredExpression: boundMetadataText(authoredExpression.replace(/\s+/gu, ' ')),
    ...(candidate.negateRuntimeResult === true ? { authoredExpressionNegated: true } : {}),
    column: location.character + 1,
    expression: boundMetadataText(
      (candidate.expressionLabel ?? authoredExpression).replace(/\s+/gu, ' '),
    ),
    expressionFingerprint: createPreviewRenderExpressionFingerprint(authoredExpression),
    line: location.line + 1,
    ...(ownerName === undefined ? {} : { ownerName }),
    sourcePath: path.normalize(sourcePath),
    ...candidate.metadata,
  };
  const conditionId = createConditionalRenderIdentity(sourcePath, metadata, occurrence);
  const apiExpression = `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
  const authoredValueExpression =
    candidate.negateRuntimeResult === true
      ? `(!(${authoredExpression}))`
      : `(${authoredExpression})`;
  const resolverCall =
    candidate.metadata.kind === 'logical-and'
      ? `${apiExpression}.resolveRenderConditionLazy(${JSON.stringify(conditionId)}, () => ${authoredValueExpression}, ${JSON.stringify(metadata)})`
      : `${apiExpression}.resolveRenderCondition(${JSON.stringify(conditionId)}, ${authoredValueExpression}, ${JSON.stringify(metadata)})`;
  return {
    end,
    replacement: candidate.negateRuntimeResult === true ? `!(${resolverCall})` : resolverCall,
    start,
  };
}

/** Returns whether one expression directly represents a JSX element or fragment after wrappers. */
function isDirectJsxRenderExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapConditionalExpression(expression);
  return (
    ts.isJsxElement(unwrapped) ||
    ts.isJsxSelfClosingElement(unwrapped) ||
    ts.isJsxFragment(unwrapped)
  );
}

/** Recognizes direct JSX and exact ReactDOM createPortal calls as render-bearing branches. */
function isDirectReactRenderExpression(
  expression: ts.Expression,
  portalBindings: ReactDomPortalBindings,
): boolean {
  const unwrapped = unwrapConditionalExpression(expression);
  return (
    isDirectJsxRenderExpression(unwrapped) ||
    isPreviewReactCreateElementCall(unwrapped) ||
    isReactDomPortalCall(unwrapped, portalBindings)
  );
}

/**
 * Recognizes a direct overlay branch whose dormant state can hide the selected-file subtree.
 *
 * Component naming is used only as structural evidence and exact ReactDOM portals are always visual
 * layers. The result annotates an existing condition; it never instruments a non-render expression.
 */
function isOverlayReactRenderExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): boolean {
  const unwrapped = unwrapConditionalExpression(expression);
  if (isReactDomPortalCall(unwrapped, portalBindings)) return true;
  if (isPreviewReactCreateElementCall(unwrapped)) {
    const componentType = unwrapped.arguments[0];
    const componentName = componentType?.getText(sourceFile);
    return (
      componentName?.split('.').some((segment) => OVERLAY_COMPONENT_NAME_PATTERN.test(segment)) ===
      true
    );
  }
  const tagName = ts.isJsxElement(unwrapped)
    ? unwrapped.openingElement.tagName.getText(sourceFile)
    : ts.isJsxSelfClosingElement(unwrapped)
      ? unwrapped.tagName.getText(sourceFile)
      : undefined;
  return (
    tagName?.split('.').some((segment) => OVERLAY_COMPONENT_NAME_PATTERN.test(segment)) === true
  );
}

/**
 * Recognizes the object half of an authored React Router-style conditional route entry.
 *
 * The property name and a direct JSX value are both required. That narrow proof keeps ordinary
 * `condition && object` computations unchanged while allowing the Inspector to reveal a page route
 * that an authentication, role, feature, or application-mode condition removed from a route array.
 */
function isJsxRouteEntryExpression(
  expression: ts.Expression,
): expression is ts.ObjectLiteralExpression {
  const unwrapped = unwrapConditionalExpression(expression);
  if (!ts.isObjectLiteralExpression(unwrapped)) return false;
  return unwrapped.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const propertyName = readStaticPropertyName(property.name);
    return propertyName === 'element' && isDirectJsxRenderExpression(property.initializer);
  });
}

/** Reads an identifier or quoted object key without evaluating computed project expressions. */
function readStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** Labels a conditional route with its JSX page element so target-path scoring can select it. */
function describeJsxRouteEntry(
  expression: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): string {
  const elementProperty = expression.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      readStaticPropertyName(property.name) === 'element' &&
      isDirectJsxRenderExpression(property.initializer),
  );
  return elementProperty === undefined
    ? '<Route> entry'
    : `${describeJsxRenderExpression(elementProperty.initializer, sourceFile)} route`;
}

/** Proves createPortal through a named import or ReactDOM namespace/default binding. */
function isReactDomPortalCall(
  expression: ts.Expression,
  bindings: ReactDomPortalBindings,
): expression is ts.CallExpression {
  if (!ts.isCallExpression(expression)) return false;
  const callee = unwrapConditionalExpression(expression.expression);
  if (ts.isIdentifier(callee)) return bindings.direct.has(callee.text);
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'createPortal' &&
    ts.isIdentifier(callee.expression) &&
    bindings.namespaces.has(callee.expression.text)
  );
}

/** Produces a concise JSX tag label while keeping arbitrary branch expressions bounded. */
function describeRenderBranch(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): string {
  if (isDirectJsxRenderExpression(expression)) {
    return describeJsxRenderExpression(expression, sourceFile);
  }
  const unwrapped = unwrapConditionalExpression(expression);
  if (isReactDomPortalCall(unwrapped, portalBindings)) {
    const portalChild = unwrapped.arguments[0];
    return portalChild !== undefined && isDirectJsxRenderExpression(portalChild)
      ? `${describeJsxRenderExpression(portalChild, sourceFile)} portal overlay`
      : '<Portal> overlay';
  }
  if (isPreviewReactCreateElementCall(unwrapped)) {
    return describeReactCreateElement(unwrapped, sourceFile);
  }
  return boundMetadataText(unwrapped.getText(sourceFile));
}

/** Labels a conventional React.createElement terminal without evaluating its component value. */
function describeReactCreateElement(call: ts.CallExpression, sourceFile: ts.SourceFile): string {
  const componentType = call.arguments[0];
  if (componentType === undefined) return '<React element>';
  const unwrapped = unwrapConditionalExpression(componentType);
  if (
    ts.isIdentifier(unwrapped) ||
    ts.isPropertyAccessExpression(unwrapped) ||
    ts.isStringLiteralLike(unwrapped)
  ) {
    return `<${boundMetadataText(
      ts.isStringLiteralLike(unwrapped) ? unwrapped.text : unwrapped.getText(sourceFile),
    )}>`;
  }
  return '<React element>';
}

/**
 * Combines every direct leaf proven behind an alias, array, ternary, or map callback.
 * The component names remain visible in one bounded label so target-path scoring can associate each
 * flattened guard with the selected descendant instead of treating the guard as an unrelated sibling.
 */
function describeRenderTerminalEvidence(
  evidence: PreviewReactRenderTerminalEvidence,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): string {
  const labels: string[] = [];
  for (const terminal of evidence.terminals) {
    const label = isJsxRouteEntryExpression(terminal)
      ? describeJsxRouteEntry(terminal, sourceFile)
      : describeRenderBranch(terminal, sourceFile, portalBindings);
    if (!labels.includes(label) && labels.length < 8) labels.push(label);
  }
  return boundMetadataText(labels.join(' | ') || 'render value');
}

/**
 * Reads bounded direct component names from a fragment branch.
 *
 * A logical gate commonly wraps several target descendants in a Fragment. Keeping those names in
 * the branch label lets target-path scoring choose the gate without turning every `&&` expression
 * on the surrounding page on. Nested expressions remain opaque so this stays a local syntax proof.
 */
function describeJsxFragment(fragment: ts.JsxFragment, sourceFile: ts.SourceFile): string {
  const componentNames: string[] = [];
  for (const child of fragment.children) {
    const tagName = ts.isJsxElement(child)
      ? child.openingElement.tagName.getText(sourceFile)
      : ts.isJsxSelfClosingElement(child)
        ? child.tagName.getText(sourceFile)
        : undefined;
    if (tagName === undefined || componentNames.includes(tagName) || componentNames.length >= 8) {
      continue;
    }
    componentNames.push(boundMetadataText(tagName));
  }
  return componentNames.length === 0 ? '<Fragment>' : `<Fragment: ${componentNames.join(', ')}>`;
}

/** Reads the authored component/tag name from a direct JSX branch. */
function describeJsxRenderExpression(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  const unwrapped = unwrapConditionalExpression(expression);
  if (ts.isJsxFragment(unwrapped)) {
    return describeJsxFragment(unwrapped, sourceFile);
  }
  if (ts.isJsxElement(unwrapped)) {
    return `<${boundMetadataText(unwrapped.openingElement.tagName.getText(sourceFile))}>`;
  }
  if (ts.isJsxSelfClosingElement(unwrapped)) {
    return `<${boundMetadataText(unwrapped.tagName.getText(sourceFile))}>`;
  }
  return 'JSX branch';
}

/** Removes syntax-only wrappers that do not change whether an expression is direct JSX. */
function unwrapConditionalExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Marks a recognizable placeholder/loading/error branch so the UI can call it out explicitly. */
function inferFallbackBranch(
  truthyLabel: string,
  falsyLabel: string,
): Pick<ReactConditionalRenderMetadata, 'fallbackBranch'> | Record<string, never> {
  const truthyFallback = isFallbackBranchLabel(truthyLabel);
  const falsyFallback = isFallbackBranchLabel(falsyLabel);
  if (truthyFallback === falsyFallback) {
    return {};
  }
  return { fallbackBranch: truthyFallback ? 'truthy' : 'falsy' };
}

/** Recognizes common authored fallback component names without assigning project-specific meaning. */
function isFallbackBranchLabel(label: string): boolean {
  return /fallback|empty|error|loading|placeholder|skeleton|spinner|no[-_ ]?data|log[-_ ]?in|sign[-_ ]?in|unauthori[sz]ed|forbidden|access[-_ ]?denied|navigate|redirect/iu.test(
    label,
  );
}

/** Creates an opaque, hot-reload-stable identity from source semantics and bounded occurrence order. */
function createConditionalRenderIdentity(
  sourcePath: string,
  metadata: ReactConditionalRenderMetadata,
  occurrence: number,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        path.normalize(sourcePath),
        metadata.kind,
        metadata.expressionFingerprint,
        metadata.expression,
        metadata.truthyLabel,
        metadata.falsyLabel,
        occurrence,
      ]),
    )
    .digest('hex')
    .slice(0, 24);
}

/** Keeps source labels readable without allowing one expression to dominate persisted UI state. */
function boundMetadataText(value: string): string {
  const normalized = value.trim();
  return normalized.length <= MAX_METADATA_TEXT_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_METADATA_TEXT_LENGTH - 1)}…`;
}

/** Selects a JSX-capable parser grammar for every source extension accepted by the compiler. */
function selectConditionalScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX;
}

/** Restricts instrumentation to modules esbuild can load as JavaScript or TypeScript source. */
function isJavaScriptLikeSource(sourcePath: string): boolean {
  return /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/iu.test(sourcePath);
}

/** Avoids a TypeScript parse for modules with no plausible supported conditional JSX syntax. */
function mayContainConditionalJsx(sourceText: string): boolean {
  const containsReactFactory = sourceText.includes('React.createElement');
  return (
    (sourceText.includes('<') || containsReactFactory) &&
    (sourceText.includes('&&') ||
      sourceText.includes('?') ||
      sourceText.includes('if') ||
      sourceText.includes('createPortal') ||
      (sourceText.includes('return null') &&
        /\b[A-Za-z_$][\w$]*(?:Modal|Dialog|Drawer|Popover|Overlay|Portal|Sheet|Lightbox|Tooltip|Toast|Dropdown|Menu)\b/u.test(
          sourceText,
        )) ||
      /\b(?:active|defaultOpen|defaultVisible|expanded|hidden|isHidden|isOpen|isVisible|open|present|show|shown|visible)\s*=/u.test(
        sourceText,
      ))
  );
}

/** Rejects parser recovery so replacements never address an incomplete or ambiguous syntax tree. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}
