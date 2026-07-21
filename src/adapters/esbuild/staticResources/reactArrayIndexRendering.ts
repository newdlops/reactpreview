/**
 * Instruments component-local JSX arrays selected through a dynamic numeric index.
 *
 * Wizards and onboarding pages often declare `const steps = [<Step0 />, <Step1 />]` and later
 * return `steps[currentStep]`. The early gate that precedes this expression is not sufficient to
 * reveal a selected step: an absent query/state value can still index the array with `null` and
 * produce no host output. This analyzer exposes each statically authored array item through the
 * same bounded render-choice runtime used by switch statements.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

const MAX_ARRAY_CHOICES_PER_MODULE = 32;
const MAX_ARRAY_CHOICE_BRANCHES = 32;
const MAX_BRANCH_COMPONENT_CALLS = 16;
const PREVIEW_INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';
const MUTATING_ARRAY_METHODS = new Set([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift',
]);

/** One replacement around the dynamic element-access argument. */
interface ReactArrayIndexReplacement {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
}

/** A component-local JSX array and the function scope that owns its index expression. */
interface ReactArrayIndexCandidate {
  readonly access: ts.ElementAccessExpression;
  readonly array: ts.ArrayLiteralExpression;
  readonly ownerName: string;
}

/** One exact lexical identifier binding visible from a candidate access. */
interface ReactArrayIdentifierBinding {
  readonly identifier: ts.Identifier;
  readonly variableDeclaration?: ts.VariableDeclaration;
  readonly variableDeclarationList?: ts.VariableDeclarationList;
}

/** Runtime function forms that can own executable JSX selection state. */
type ReactArrayRuntimeFunction =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;

/**
 * Wraps safe JSX-array index expressions in the Inspector render-choice resolver.
 *
 * Only direct, fixed array literals with two to thirty-two JSX/null items are admitted. Spread,
 * omitted, mutated, or non-render values fail closed, and project expressions are never executed
 * by the extension host.
 *
 * @param sourcePath Absolute workspace source identity used by Inspector navigation.
 * @param sourceText Authored JavaScript/TypeScript source.
 * @returns Source with bounded dynamic JSX-array choices instrumented.
 */
export function instrumentReactArrayIndexRendering(sourcePath: string, sourceText: string): string {
  if (!isJavaScriptLikeSource(sourcePath) || !sourceText.includes('[')) return sourceText;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return sourceText;
  const candidates = collectReactArrayIndexCandidates(sourceFile).slice(
    0,
    MAX_ARRAY_CHOICES_PER_MODULE,
  );
  const replacements = candidates.map((candidate, occurrence) =>
    createReactArrayIndexReplacement(sourceFile, sourcePath, candidate, occurrence),
  );
  let transformed = sourceText;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed =
      transformed.slice(0, replacement.start) +
      replacement.replacement +
      transformed.slice(replacement.end);
  }
  return transformed;
}

/** Finds dynamic reads whose local identifier resolves to one immutable-looking JSX array. */
function collectReactArrayIndexCandidates(
  sourceFile: ts.SourceFile,
): readonly ReactArrayIndexCandidate[] {
  const candidates: ReactArrayIndexCandidate[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isElementAccessExpression(node) &&
      !ts.isStringLiteralLike(node.argumentExpression) &&
      !ts.isNumericLiteral(node.argumentExpression) &&
      !isPreviewInspectorRenderChoiceCall(node.argumentExpression)
    ) {
      const collection = unwrapExpression(node.expression);
      const owner = findNearestRuntimeFunction(node);
      const ownerName =
        owner === undefined ? undefined : readRuntimeFunctionName(owner, sourceFile);
      if (owner !== undefined && ownerName !== undefined && ts.isIdentifier(collection)) {
        const binding = findVisibleIdentifierBinding(owner, node, collection.text);
        const array = readBoundConstJsxArray(binding, node);
        if (
          array !== undefined &&
          isSupportedJsxArray(array) &&
          binding !== undefined &&
          !isArrayBindingMutated(owner, binding)
        ) {
          candidates.push({ access: node, array, ownerName });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
}

/** Resolves the closest block/function binding visible at one access without using a type checker. */
function findVisibleIdentifierBinding(
  owner: ReactArrayRuntimeFunction,
  reference: ts.Node,
  identifierName: string,
): ReactArrayIdentifierBinding | undefined {
  let current: ts.Node = reference;
  while (current !== owner) {
    const parent = current.parent;
    if (ts.isBlock(parent) || ts.isCaseBlock(parent)) {
      const binding = readDirectLexicalBinding(parent, identifierName);
      if (binding !== undefined) return binding;
    }
    if (
      (ts.isForStatement(parent) || ts.isForInStatement(parent) || ts.isForOfStatement(parent)) &&
      parent.statement === current
    ) {
      const binding = readLoopLexicalBinding(parent, identifierName);
      if (binding !== undefined) return binding;
    }
    if (ts.isCatchClause(parent) && parent.block === current) {
      const identifier = readBindingIdentifier(parent.variableDeclaration?.name, identifierName);
      if (identifier !== undefined) return { identifier };
    }
    if (isReactArrayRuntimeFunction(parent)) {
      const parameter = parent.parameters
        .map((item) => readBindingIdentifier(item.name, identifierName))
        .find((item) => item !== undefined);
      if (parameter !== undefined) return { identifier: parameter };
      if (parent !== owner) {
        const functionName = parent.name;
        if (
          functionName !== undefined &&
          ts.isIdentifier(functionName) &&
          functionName.text === identifierName
        ) {
          return { identifier: functionName };
        }
      }
    }
    current = parent;
  }
  const ownerParameter = owner.parameters
    .map((item) => readBindingIdentifier(item.name, identifierName))
    .find((item) => item !== undefined);
  return ownerParameter === undefined ? undefined : { identifier: ownerParameter };
}

/** Reads a direct block binding and deliberately stops outer lookup on non-array shadows. */
function readDirectLexicalBinding(
  scope: ts.Block | ts.CaseBlock,
  identifierName: string,
): ReactArrayIdentifierBinding | undefined {
  const statements = ts.isCaseBlock(scope)
    ? scope.clauses.flatMap((clause) => [...clause.statements])
    : scope.statements;
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const identifier = readBindingIdentifier(declaration.name, identifierName);
        if (identifier !== undefined) {
          return {
            identifier,
            variableDeclaration: declaration,
            variableDeclarationList: statement.declarationList,
          };
        }
      }
    }
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === identifierName
    ) {
      return { identifier: statement.name };
    }
  }
  return undefined;
}

/** Reads a `for` initializer binding whose lexical scope includes the loop body. */
function readLoopLexicalBinding(
  loop: ts.ForStatement | ts.ForInStatement | ts.ForOfStatement,
  identifierName: string,
): ReactArrayIdentifierBinding | undefined {
  const initializer = loop.initializer;
  if (initializer === undefined || !ts.isVariableDeclarationList(initializer)) return undefined;
  for (const declaration of initializer.declarations) {
    const identifier = readBindingIdentifier(declaration.name, identifierName);
    if (identifier !== undefined) {
      return {
        identifier,
        variableDeclaration: declaration,
        variableDeclarationList: initializer,
      };
    }
  }
  return undefined;
}

/** Finds one identifier inside an identifier/object/tuple binding without following defaults. */
function readBindingIdentifier(
  binding: ts.BindingName | undefined,
  identifierName: string,
): ts.Identifier | undefined {
  if (binding === undefined) return undefined;
  if (ts.isIdentifier(binding)) return binding.text === identifierName ? binding : undefined;
  for (const element of binding.elements) {
    if (ts.isOmittedExpression(element)) continue;
    const identifier = readBindingIdentifier(element.name, identifierName);
    if (identifier !== undefined) return identifier;
  }
  return undefined;
}

/** Admits only a preceding direct `const name = [JSX...]` binding at the selected lexical site. */
function readBoundConstJsxArray(
  binding: ReactArrayIdentifierBinding | undefined,
  access: ts.ElementAccessExpression,
): ts.ArrayLiteralExpression | undefined {
  const declaration = binding?.variableDeclaration;
  const declarationList = binding?.variableDeclarationList;
  if (
    binding === undefined ||
    declaration === undefined ||
    declarationList === undefined ||
    declaration.name !== binding.identifier ||
    (declarationList.flags & ts.NodeFlags.Const) === 0 ||
    declaration.initializer === undefined ||
    declaration.end > access.getStart()
  ) {
    return undefined;
  }
  const initializer = unwrapExpression(declaration.initializer);
  return ts.isArrayLiteralExpression(initializer) ? initializer : undefined;
}

/** Rejects reassignment, element/property writes, updates, deletes, and known mutator calls. */
function isArrayBindingMutated(
  owner: ReactArrayRuntimeFunction,
  binding: ReactArrayIdentifierBinding,
): boolean {
  let mutated = false;
  const visit = (node: ts.Node): void => {
    if (mutated) return;
    if (
      ts.isIdentifier(node) &&
      node !== binding.identifier &&
      node.text === binding.identifier.text &&
      findVisibleIdentifierBinding(owner, node, node.text)?.identifier === binding.identifier &&
      (isIdentifierAccessWritten(node) || isKnownArrayMutatorCalled(node))
    ) {
      mutated = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (owner.body !== undefined) visit(owner.body);
  return mutated;
}

/** Follows transparent/member access to decide whether the selected array is an assignment target. */
function isIdentifierAccessWritten(identifier: ts.Identifier): boolean {
  return isExpressionAccessWritten(identifier);
}

/** Recursively reaches the outermost member access before classifying its write context. */
function isExpressionAccessWritten(target: ts.Expression): boolean {
  const parent = target.parent;
  if (
    ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === target) ||
    ((ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent)) &&
      parent.expression === target)
  ) {
    return isExpressionAccessWritten(parent);
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === target &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return true;
  }
  if (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    parent.operand === target
  ) {
    return (
      parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken
    );
  }
  if (ts.isDeleteExpression(parent) && parent.expression === target) return true;
  return (
    (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === target
  );
}

/** Recognizes mutating native Array methods invoked with the selected array as their receiver. */
function isKnownArrayMutatorCalled(identifier: ts.Identifier): boolean {
  const access = identifier.parent;
  if (
    (ts.isPropertyAccessExpression(access) || ts.isElementAccessExpression(access)) &&
    access.expression === identifier &&
    ts.isCallExpression(access.parent) &&
    access.parent.expression === access
  ) {
    const methodName = ts.isPropertyAccessExpression(access)
      ? access.name.text
      : ts.isStringLiteralLike(access.argumentExpression)
        ? access.argumentExpression.text
        : undefined;
    return methodName === undefined || MUTATING_ARRAY_METHODS.has(methodName);
  }
  return false;
}

/** Detects the exact global Symbol receiver emitted by this transform on an earlier pass. */
function isPreviewInspectorRenderChoiceCall(expression: ts.Expression): boolean {
  const call = unwrapExpression(expression);
  if (!ts.isCallExpression(call)) return false;
  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'resolveRenderChoice') {
    return false;
  }
  const receiver = unwrapExpression(callee.expression);
  if (!ts.isElementAccessExpression(receiver)) return false;
  const receiverRoot = unwrapExpression(receiver.expression);
  if (!ts.isIdentifier(receiverRoot) || receiverRoot.text !== 'globalThis') {
    return false;
  }
  const symbolCall = unwrapExpression(receiver.argumentExpression);
  if (!ts.isCallExpression(symbolCall) || symbolCall.arguments.length !== 1) return false;
  const symbolCallee = unwrapExpression(symbolCall.expression);
  const symbolArgument = symbolCall.arguments[0];
  if (symbolArgument === undefined) return false;
  const symbolName = unwrapExpression(symbolArgument);
  const symbolReceiver = ts.isPropertyAccessExpression(symbolCallee)
    ? unwrapExpression(symbolCallee.expression)
    : undefined;
  return (
    ts.isPropertyAccessExpression(symbolCallee) &&
    symbolReceiver !== undefined &&
    ts.isIdentifier(symbolReceiver) &&
    symbolReceiver.text === 'Symbol' &&
    symbolCallee.name.text === 'for' &&
    ts.isStringLiteralLike(symbolName) &&
    symbolName.text === PREVIEW_INSPECTOR_API_SYMBOL
  );
}

/** Requires a finite direct render value at every index so each forced number remains safe. */
function isSupportedJsxArray(array: ts.ArrayLiteralExpression): boolean {
  return (
    array.elements.length >= 2 &&
    array.elements.length <= MAX_ARRAY_CHOICE_BRANCHES &&
    array.elements.every((element) => {
      if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) return false;
      const value = unwrapExpression(element);
      return (
        ts.isJsxElement(value) ||
        ts.isJsxSelfClosingElement(value) ||
        ts.isJsxFragment(value) ||
        value.kind === ts.SyntaxKind.NullKeyword
      );
    })
  );
}

/** Creates numeric branches whose component-call labels can be joined to the target path. */
function createReactArrayIndexReplacement(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  candidate: ReactArrayIndexCandidate,
  occurrence: number,
): ReactArrayIndexReplacement {
  const argument = candidate.access.argumentExpression;
  const start = argument.getStart(sourceFile);
  const end = argument.end;
  const location = sourceFile.getLineAndCharacterOfPosition(start);
  const normalizedSourcePath = path.normalize(sourcePath);
  const identity = createHash('sha256')
    .update(
      [
        normalizedSourcePath,
        candidate.ownerName,
        location.line + 1,
        location.character + 1,
        occurrence,
      ].join('\0'),
    )
    .digest('hex')
    .slice(0, 24);
  const branches = candidate.array.elements.map((element, index) => {
    const calls = collectComponentCalls(unwrapExpression(element));
    return {
      ...(calls.length === 0 ? {} : { calls }),
      id: `${identity}:index-${String(index)}`,
      label: `index ${String(index)} → ${calls.length === 0 ? 'empty render' : `<${calls.join(', ')}>`}`,
      selectable: true,
      value: index,
    };
  });
  const metadata = {
    branches,
    column: location.character + 1,
    expression: argument.getText(sourceFile).replace(/\s+/gu, ' ').slice(0, 180),
    kind: 'array-index',
    line: location.line + 1,
    ownerName: candidate.ownerName,
    sourcePath: normalizedSourcePath,
  };
  const api = `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
  return {
    end,
    replacement: `${api}.resolveRenderChoice(${JSON.stringify(identity)}, (${argument.getText(sourceFile)}), ${JSON.stringify(metadata)})`,
    start,
  };
}

/** Collects component-like JSX tag names without crossing nested callback bodies. */
function collectComponentCalls(expression: ts.Expression): readonly string[] {
  const calls: string[] = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      calls.length >= MAX_BRANCH_COMPONENT_CALLS ||
      (node !== expression && ts.isFunctionLike(node))
    ) {
      return;
    }
    const tag = ts.isJsxElement(node)
      ? node.openingElement.tagName.getText()
      : ts.isJsxSelfClosingElement(node)
        ? node.tagName.getText()
        : undefined;
    if (tag !== undefined && /^[$_\p{Lu}]/u.test(tag) && !seen.has(tag)) {
      seen.add(tag);
      calls.push(tag);
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return calls;
}

/** Finds the closest runtime function whose local array and index share lexical state. */
function findNearestRuntimeFunction(node: ts.Node): ReactArrayRuntimeFunction | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (isReactArrayRuntimeFunction(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/** Narrows syntax nodes to executable function forms supported by this local analyzer. */
function isReactArrayRuntimeFunction(node: ts.Node): node is ReactArrayRuntimeFunction {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Reads a declaration/variable function name required for path-local Inspector attachment. */
function readRuntimeFunctionName(
  owner: ReactArrayRuntimeFunction,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (owner.name !== undefined) return owner.name.getText(sourceFile);
  const parent = owner.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : undefined;
}

/** Removes only syntax wrappers that preserve an expression's exact runtime identity. */
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

/** Selects TypeScript's parser grammar from the source extension. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Reports parser recovery so instrumentation can fail closed on incomplete editor text. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  return (
    ((
      sourceFile as ts.SourceFile & {
        readonly parseDiagnostics?: readonly ts.Diagnostic[];
      }
    ).parseDiagnostics?.length ?? 0) > 0
  );
}

/** Restricts instrumentation to source forms whose parser supports JSX or TypeScript syntax. */
function isJavaScriptLikeSource(sourcePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/iu.test(sourcePath);
}
