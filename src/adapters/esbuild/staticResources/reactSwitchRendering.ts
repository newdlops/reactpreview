/**
 * Instruments bounded component-local switch returns for React Page Inspector render choices.
 *
 * The transform is intentionally syntax-only. It never evaluates project code, replaces only the
 * switch discriminant, and admits a switch only when every clause directly returns JSX, an exact
 * ReactDOM portal, or null. Literal cases can then be selected without inventing project values;
 * dynamic cases remain useful read-only flow evidence.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

const MAX_SWITCHES_PER_MODULE = 32;
const MAX_SWITCH_BRANCHES = 32;
const MAX_BRANCH_CALLS = 16;
const MAX_METADATA_TEXT_LENGTH = 180;
const PREVIEW_INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';

/** Imported ReactDOM identities that statically prove a createPortal render expression. */
interface ReactDomPortalBindings {
  readonly direct: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
}

/** JSON-safe literal values that may safely be returned as a forced switch discriminant. */
export type ReactSwitchLiteralValue = string | number | boolean | null;

/** One rendered switch clause exposed to the browser choice registry. */
export interface ReactSwitchRenderBranchMetadata {
  /** Component names directly referenced by the returned render expression. */
  readonly calls?: readonly string[];
  /** Marks the authored default clause, whose forced sentinel can miss every literal case. */
  readonly default?: true;
  /** Stable identity scoped beneath the switch choice identity. */
  readonly id: string;
  /** Bounded source-and-render label shown in the Inspector. */
  readonly label: string;
  /** Whether the browser may safely force this branch without evaluating a case expression. */
  readonly selectable: boolean;
  /** Exact primitive discriminant for supported literal cases. */
  readonly value?: ReactSwitchLiteralValue;
}

/** Serializable switch metadata retained by the browser without project runtime references. */
export interface ReactSwitchRenderMetadata {
  readonly branches: readonly ReactSwitchRenderBranchMetadata[];
  readonly column: number;
  readonly expression: string;
  readonly kind: 'switch';
  readonly line: number;
  readonly ownerName: string;
  readonly sourcePath: string;
}

/** A valid switch discovered before stable IDs and browser metadata are assigned. */
interface ReactSwitchRenderCandidate {
  readonly discriminant: ts.Expression;
  readonly ownerName: string;
  readonly statement: ts.SwitchStatement;
}

/** A source replacement whose range addresses the original parsed module. */
interface ReactSwitchRenderReplacement {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
}

/** Parsed information for one case or default clause. */
interface ReactSwitchClauseEvidence {
  readonly calls: readonly string[];
  readonly default: boolean;
  readonly expression?: ts.Expression;
  readonly label: string;
  readonly literal?: ReactSwitchLiteralValue;
  readonly literalSupported: boolean;
}

/**
 * Adds one Page Inspector choice resolver around each safely bounded component switch expression.
 *
 * @param sourcePath Absolute workspace source identity and parser-grammar hint.
 * @param sourceText JavaScript or TypeScript source after compatibility rewrites.
 * @returns Instrumented source, or the original text when no safe render switch is proven.
 */
export function instrumentReactSwitchRendering(sourcePath: string, sourceText: string): string {
  if (!isJavaScriptLikeSource(sourcePath) || !/\bswitch\s*\(/u.test(sourceText)) {
    return sourceText;
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
  if ((parseDiagnostics?.length ?? 0) > 0) return sourceText;
  const portalBindings = collectReactDomPortalBindings(sourceFile);
  const candidates = collectSwitchRenderCandidates(sourceFile, portalBindings).slice(
    0,
    MAX_SWITCHES_PER_MODULE,
  );
  const replacements = candidates.map((candidate, occurrence) =>
    createSwitchRenderReplacement(sourceFile, sourcePath, candidate, occurrence, portalBindings),
  );
  return applySwitchRenderReplacements(sourceText, replacements);
}

/** Collects only PascalCase component switches whose complete clause set is directly renderable. */
function collectSwitchRenderCandidates(
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): readonly ReactSwitchRenderCandidate[] {
  const candidates: ReactSwitchRenderCandidate[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isSwitchStatement(node)) {
      const owner = findNearestRenderFunction(node);
      const ownerName = owner === undefined ? undefined : readRenderFunctionName(owner, sourceFile);
      if (
        ownerName !== undefined &&
        isPascalCaseComponentName(ownerName) &&
        readSwitchClauseEvidence(node, sourceFile, portalBindings) !== undefined
      ) {
        candidates.push({ discriminant: node.expression, ownerName, statement: node });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
}

/** Requires every bounded clause to contain exactly one direct supported return statement. */
function readSwitchClauseEvidence(
  statement: ts.SwitchStatement,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): readonly ReactSwitchClauseEvidence[] | undefined {
  const clauses = statement.caseBlock.clauses;
  if (clauses.length < 2 || clauses.length > MAX_SWITCH_BRANCHES) return undefined;
  const evidence: ReactSwitchClauseEvidence[] = [];
  for (const clause of clauses) {
    if (clause.statements.length !== 1) return undefined;
    const returned = clause.statements[0];
    if (returned === undefined) return undefined;
    if (!ts.isReturnStatement(returned) || returned.expression === undefined) return undefined;
    const renderExpression = unwrapExpression(returned.expression);
    if (
      renderExpression.kind !== ts.SyntaxKind.NullKeyword &&
      !isDirectJsxExpression(renderExpression) &&
      !isReactDomPortalCall(renderExpression, portalBindings)
    ) {
      return undefined;
    }
    const defaultClause = ts.isDefaultClause(clause);
    const caseExpression = defaultClause ? undefined : clause.expression;
    const literalEvidence =
      caseExpression === undefined ? undefined : readSwitchLiteralValue(caseExpression);
    const renderLabel = describeReturnedRender(renderExpression, sourceFile, portalBindings);
    const caseLabel = defaultClause
      ? 'default'
      : `case ${boundMetadataText(caseExpression?.getText(sourceFile) ?? 'unknown')}`;
    evidence.push({
      calls: collectReturnedComponentCalls(renderExpression, sourceFile),
      default: defaultClause,
      ...(caseExpression === undefined ? {} : { expression: caseExpression }),
      label: `${caseLabel} → ${renderLabel}`,
      ...(literalEvidence?.supported === true ? { literal: literalEvidence.value } : {}),
      literalSupported: literalEvidence?.supported === true,
    });
  }
  return evidence;
}

/** Creates stable branch metadata and a resolver call that contains the discriminant exactly once. */
function createSwitchRenderReplacement(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  candidate: ReactSwitchRenderCandidate,
  occurrence: number,
  portalBindings: ReactDomPortalBindings,
): ReactSwitchRenderReplacement {
  const start = candidate.discriminant.getStart(sourceFile);
  const end = candidate.discriminant.end;
  const authoredExpression = sourceFile.text.slice(start, end);
  const location = sourceFile.getLineAndCharacterOfPosition(start);
  const normalizedSourcePath = path.normalize(sourcePath);
  const choiceId = createSwitchRenderIdentity(
    normalizedSourcePath,
    candidate.ownerName,
    location.line + 1,
    location.character + 1,
    occurrence,
  );
  const clauseEvidence = readSwitchClauseEvidence(candidate.statement, sourceFile, portalBindings);
  const allCasesLiteral =
    clauseEvidence?.every((branch) => branch.default || branch.literalSupported) === true;
  let dynamicCaseSeen = false;
  const seenLiterals = new Set<string>();
  const branches: ReactSwitchRenderBranchMetadata[] = (clauseEvidence ?? []).map(
    (branch, index) => {
      const branchId = `${choiceId}:${branch.default ? 'default' : `case-${String(index)}`}`;
      let selectable = false;
      if (branch.default) {
        selectable = allCasesLiteral;
      } else if (branch.literalSupported) {
        const literalKey = createSwitchLiteralKey(branch.literal);
        selectable = !dynamicCaseSeen && !seenLiterals.has(literalKey);
        seenLiterals.add(literalKey);
      } else {
        dynamicCaseSeen = true;
      }
      return {
        ...(branch.calls.length === 0 ? {} : { calls: branch.calls }),
        ...(branch.default ? { default: true as const } : {}),
        id: branchId,
        label: branch.label,
        selectable,
        ...(branch.literalSupported ? { value: branch.literal } : {}),
      };
    },
  );
  const metadata: ReactSwitchRenderMetadata = {
    branches,
    column: location.character + 1,
    expression: boundMetadataText(authoredExpression.replace(/\s+/gu, ' ')),
    kind: 'switch',
    line: location.line + 1,
    ownerName: candidate.ownerName,
    sourcePath: normalizedSourcePath,
  };
  const apiExpression = `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
  return {
    end,
    replacement: `${apiExpression}.resolveRenderChoice(${JSON.stringify(choiceId)}, (${authoredExpression}), ${JSON.stringify(metadata)})`,
    start,
  };
}

/** Reads primitive case syntax without resolving identifiers, enums, calls, or property access. */
function readSwitchLiteralValue(
  expression: ts.Expression,
): { readonly supported: true; readonly value: ReactSwitchLiteralValue } | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteralLike(unwrapped)) return { supported: true, value: unwrapped.text };
  if (ts.isNumericLiteral(unwrapped)) {
    const value = Number(unwrapped.text);
    return Number.isFinite(value) ? { supported: true, value } : undefined;
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return { supported: true, value: true };
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return { supported: true, value: false };
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return { supported: true, value: null };
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    (unwrapped.operator === ts.SyntaxKind.MinusToken ||
      unwrapped.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(unwrapExpression(unwrapped.operand))
  ) {
    const operand = unwrapExpression(unwrapped.operand);
    if (!ts.isNumericLiteral(operand)) return undefined;
    const magnitude = Number(operand.text);
    const value = unwrapped.operator === ts.SyntaxKind.MinusToken ? -magnitude : magnitude;
    return Number.isFinite(value) ? { supported: true, value } : undefined;
  }
  return undefined;
}

/** Produces strict-equality-compatible duplicate keys for selectable primitive case values. */
function createSwitchLiteralKey(value: ReactSwitchLiteralValue | undefined): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    return `number:${String(Object.is(value, -0) ? 0 : value)}`;
  }
  return `${typeof value}:${String(value)}`;
}

/** Reads component-like JSX tags from a returned branch without crossing nested functions. */
function collectReturnedComponentCalls(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): readonly string[] {
  const calls: string[] = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (calls.length >= MAX_BRANCH_CALLS || (node !== expression && ts.isFunctionLike(node)))
      return;
    const tagName = ts.isJsxElement(node)
      ? node.openingElement.tagName.getText(sourceFile)
      : ts.isJsxSelfClosingElement(node)
        ? node.tagName.getText(sourceFile)
        : undefined;
    if (tagName !== undefined && isComponentJsxTagName(tagName) && !seen.has(tagName)) {
      seen.add(tagName);
      calls.push(tagName);
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return calls;
}

/** Describes direct JSX, Fragment, portal, and empty branches with stable readable labels. */
function describeReturnedRender(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): string {
  if (expression.kind === ts.SyntaxKind.NullKeyword) return 'empty return';
  if (isReactDomPortalCall(expression, portalBindings)) {
    const firstArgument = expression.arguments[0];
    const calls =
      firstArgument === undefined ? [] : collectReturnedComponentCalls(firstArgument, sourceFile);
    return calls.length === 0 ? '<Portal>' : `<Portal: ${calls.join(', ')}>`;
  }
  if (ts.isJsxFragment(expression)) {
    const calls = collectReturnedComponentCalls(expression, sourceFile);
    return calls.length === 0 ? '<Fragment>' : `<Fragment: ${calls.join(', ')}>`;
  }
  const tagName = ts.isJsxElement(expression)
    ? expression.openingElement.tagName.getText(sourceFile)
    : ts.isJsxSelfClosingElement(expression)
      ? expression.tagName.getText(sourceFile)
      : 'JSX';
  return `<${tagName}>`;
}

/** Finds the nearest function boundary that owns the authored switch. */
function findNearestRenderFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
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

/** Recovers a component name through bounded memo, HOC, and styled factory wrappers. */
function readRenderFunctionName(
  owner: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (owner.name !== undefined) return owner.name.getText(sourceFile);
  let current: ts.Node = owner;
  for (let depth = 0; depth < 8; depth += 1) {
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
    if (!isTransparentComponentWrapper(parent, current)) break;
    current = parent;
  }
  return undefined;
}

/** Admits only syntax wrappers that keep a render function inside the same authored binding. */
function isTransparentComponentWrapper(parent: ts.Node, child: ts.Node): boolean {
  if (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeAssertionExpression(parent)
  ) {
    return parent.expression === child;
  }
  if (ts.isCallExpression(parent)) return parent.arguments.includes(child as ts.Expression);
  return ts.isTaggedTemplateExpression(parent) && parent.tag === child;
}

/** Removes TypeScript/parenthesis wrappers that do not change direct render or literal syntax. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
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

/** Recognizes a direct JSX element or Fragment after transparent syntax wrappers. */
function isDirectJsxExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return (
    ts.isJsxElement(unwrapped) ||
    ts.isJsxSelfClosingElement(unwrapped) ||
    ts.isJsxFragment(unwrapped)
  );
}

/** Recognizes an imported ReactDOM createPortal call without accepting same-name project functions. */
function isReactDomPortalCall(
  expression: ts.Expression,
  bindings: ReactDomPortalBindings,
): expression is ts.CallExpression {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isCallExpression(unwrapped)) return false;
  if (ts.isIdentifier(unwrapped.expression)) return bindings.direct.has(unwrapped.expression.text);
  return (
    ts.isPropertyAccessExpression(unwrapped.expression) &&
    unwrapped.expression.name.text === 'createPortal' &&
    ts.isIdentifier(unwrapped.expression.expression) &&
    bindings.namespaces.has(unwrapped.expression.expression.text)
  );
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
    const namedBindings = clause?.namedBindings;
    if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
      namespaces.add(namedBindings.name.text);
    } else if (namedBindings !== undefined) {
      for (const element of namedBindings.elements) {
        if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'createPortal') {
          direct.add(element.name.text);
        }
      }
    }
  }
  return { direct, namespaces };
}

/** Returns whether a JSX tag names a component rather than an intrinsic host element. */
function isComponentJsxTagName(tagName: string): boolean {
  const first = tagName.split('.')[0] ?? tagName;
  return /^[$_\p{Lu}]/u.test(first);
}

/** Requires a conventional upper-case component owner rather than a helper function. */
function isPascalCaseComponentName(name: string): boolean {
  return /^\p{Lu}[$_\p{L}\p{N}]*$/u.test(name);
}

/** Bounds source-derived labels before embedding them in generated browser metadata. */
function boundMetadataText(value: string): string {
  return value.slice(0, MAX_METADATA_TEXT_LENGTH);
}

/** Creates a deterministic identity stable across rebuilds that preserve source location. */
function createSwitchRenderIdentity(
  sourcePath: string,
  ownerName: string,
  line: number,
  column: number,
  occurrence: number,
): string {
  return createHash('sha256')
    .update(JSON.stringify([sourcePath, ownerName, line, column, occurrence]))
    .digest('hex')
    .slice(0, 24);
}

/** Applies non-overlapping discriminant replacements right-to-left against parser offsets. */
function applySwitchRenderReplacements(
  sourceText: string,
  replacements: readonly ReactSwitchRenderReplacement[],
): string {
  let transformed = sourceText;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.replacement}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}

/** Selects TypeScript's grammar from the source extension without consulting project config. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JSX;
}

/** Restricts parser work to source kinds transformed by the preview source pipeline. */
function isJavaScriptLikeSource(sourcePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/iu.test(sourcePath);
}
