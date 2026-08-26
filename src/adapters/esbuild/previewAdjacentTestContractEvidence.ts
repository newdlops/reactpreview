/**
 * Learns bounded, inert server return-value examples from tests colocated with a preview target.
 * Tests never become runtime owners: only complete JSON-like values passed to standard mock APIs
 * are retained, and every imported binding must resolve through the project's normal resolver.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const MAXIMUM_EVIDENCE_FILES = 8;
const MAXIMUM_EVIDENCE_FILE_BYTES = 2 * 1024 * 1024;
const MAXIMUM_TOTAL_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAXIMUM_LITERAL_DEPTH = 12;
const MAXIMUM_LITERAL_NODES = 512;
const MAXIMUM_LITERAL_COLLECTION_ITEMS = 128;
const MAXIMUM_LITERAL_STRING_LENGTH = 64 * 1024;
const MAXIMUM_SERIALIZED_VALUE_BYTES = 256 * 1024;
const MAXIMUM_HELPER_EXPANSIONS = 32;
const MAXIMUM_HELPER_CALL_DEPTH = 4;

/** Recursive object branch of a complete learned contract value. */
export interface PreviewLearnedContractObject {
  readonly [key: string]: PreviewLearnedContractValue;
}

/** Complete JSON-like value that may safely be embedded in a render-only execution contract. */
export type PreviewLearnedContractValue =
  | readonly PreviewLearnedContractValue[]
  | PreviewLearnedContractObject
  | boolean
  | number
  | string
  | null;

/** Source identity shared by every exact learned mock behavior. */
interface PreviewLearnedServerContractExampleBase {
  readonly evidenceSourcePath: string;
  readonly exportName: string;
  readonly sourcePath: string;
}

/** One exact imported export and its stable default mock behavior from an adjacent test. */
export type PreviewLearnedServerContractExample = PreviewLearnedServerContractExampleBase &
  (
    | {
        readonly mode: 'resolved' | 'returned';
        readonly value: PreviewLearnedContractValue;
      }
    | {
        readonly mode: 'returned-undefined';
        readonly value?: undefined;
      }
  );

/** Inputs for bounded adjacent-test contract collection. */
export interface PreviewAdjacentTestContractEvidenceOptions {
  readonly projectRoot: string;
  readonly readSource?: (sourcePath: string) => Promise<string | undefined> | string | undefined;
  readonly resolveModule: (moduleSpecifier: string, importerPath: string) => string | undefined;
  readonly targetPath: string;
}

interface ImportedBinding {
  readonly exportName: string;
  readonly sourcePath: string;
}

interface ImportedNamespace {
  readonly sourcePath: string;
}

interface LiteralBudget {
  nodes: number;
}

interface StaticValueScope {
  readonly bindings: ReadonlyMap<string, PreviewLearnedContractValue>;
  readonly undefinedIdentifiers: ReadonlySet<string>;
}

interface LocalMockHelper {
  readonly declaration: ts.FunctionDeclaration;
  readonly name: string;
}

/**
 * Collects the first complete default mock for each resolved source export.
 *
 * Source order is intentional: shared `beforeEach` defaults precede scenario-specific overrides in
 * conventional suites. One-shot mocks and implementations are excluded because they describe a
 * branch, not a stable render contract.
 */
export async function collectPreviewAdjacentTestContractEvidence(
  options: PreviewAdjacentTestContractEvidenceOptions,
): Promise<readonly PreviewLearnedServerContractExample[]> {
  const projectRoot = path.resolve(options.projectRoot);
  const targetPath = path.resolve(options.targetPath);
  if (!isPathInside(projectRoot, targetPath)) return Object.freeze([]);
  const evidencePaths = await collectAdjacentTestPaths(targetPath, projectRoot);
  const examples = new Map<string, PreviewLearnedServerContractExample>();
  let consumedBytes = 0;
  for (const evidenceSourcePath of evidencePaths) {
    const sourceText = await readEvidenceSource(evidenceSourcePath, options.readSource);
    if (sourceText === undefined) continue;
    const sourceBytes = Buffer.byteLength(sourceText, 'utf8');
    if (
      sourceBytes > MAXIMUM_EVIDENCE_FILE_BYTES ||
      consumedBytes + sourceBytes > MAXIMUM_TOTAL_EVIDENCE_BYTES
    ) {
      continue;
    }
    consumedBytes += sourceBytes;
    const sourceFile = ts.createSourceFile(
      evidenceSourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      readScriptKind(evidenceSourcePath),
    );
    const imports = collectResolvedImports(
      sourceFile,
      evidenceSourcePath,
      projectRoot,
      options.resolveModule,
    );
    collectMockExamples(
      sourceFile,
      evidenceSourcePath,
      imports.bindings,
      imports.namespaces,
      examples,
    );
    collectInvokedHelperMockExamples(
      sourceFile,
      evidenceSourcePath,
      imports.bindings,
      imports.namespaces,
      examples,
    );
    collectModuleFactoryMockExamples(
      sourceFile,
      evidenceSourcePath,
      projectRoot,
      options.resolveModule,
      examples,
    );
  }
  return Object.freeze([...examples.values()]);
}

/** Lists target tests plus route-ancestor layout/index tests in nearest-first order. */
async function collectAdjacentTestPaths(
  targetPath: string,
  projectRoot: string,
): Promise<readonly string[]> {
  const targetDirectory = path.dirname(targetPath);
  const targetStem = path.basename(targetPath).replace(/\.[^.]+$/u, '');
  const stemPattern = new RegExp(
    `^${escapeRegularExpression(targetStem)}\\.(?:test|spec)\\.[cm]?[jt]sx?$`,
    'iu',
  );
  const paths: string[] = [];
  await appendMatchingTestPaths(targetDirectory, stemPattern, projectRoot, paths);
  const routeRoot = findNextAppRouteRoot(targetPath, projectRoot);
  if (routeRoot !== undefined && isNextAppRouteSurface(targetPath)) {
    const routeScopePattern = /^(?:layout|page)\.(?:test|spec)\.[cm]?[jt]sx?$/iu;
    let directoryPath = targetDirectory;
    while (isPathInside(routeRoot, directoryPath)) {
      await appendMatchingTestPaths(directoryPath, routeScopePattern, projectRoot, paths);
      if (path.normalize(directoryPath) === path.normalize(routeRoot)) break;
      const parentPath = path.dirname(directoryPath);
      if (parentPath === directoryPath) break;
      directoryPath = parentPath;
    }
  }
  return Object.freeze([...new Set(paths)].slice(0, MAXIMUM_EVIDENCE_FILES));
}

/** Appends deterministic test matches beside one route segment and in its direct test folder. */
async function appendMatchingTestPaths(
  sourceDirectory: string,
  pattern: RegExp,
  projectRoot: string,
  paths: string[],
): Promise<void> {
  for (const directoryPath of [sourceDirectory, path.join(sourceDirectory, '__tests__')]) {
    if (paths.length >= MAXIMUM_EVIDENCE_FILES || !isPathInside(projectRoot, directoryPath)) break;
    try {
      const entries = (await readdir(directoryPath, { withFileTypes: true })).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      for (const entry of entries) {
        if (paths.length >= MAXIMUM_EVIDENCE_FILES) break;
        if (!entry.isFile() || entry.isSymbolicLink() || !pattern.test(entry.name)) continue;
        paths.push(path.normalize(path.join(directoryPath, entry.name)));
      }
    } catch {
      // An absent or unreadable test directory is ordinary evidence absence.
    }
  }
}

/** Finds the nearest conventional App Router root without crossing the active project. */
function findNextAppRouteRoot(targetPath: string, projectRoot: string): string | undefined {
  let directoryPath = path.dirname(targetPath);
  while (isPathInside(projectRoot, directoryPath)) {
    if (path.basename(directoryPath) === 'app') return directoryPath;
    const parentPath = path.dirname(directoryPath);
    if (parentPath === directoryPath) break;
    directoryPath = parentPath;
  }
  return undefined;
}

/** Restricts ancestor layout evidence to conventional framework-owned route surfaces. */
function isNextAppRouteSurface(targetPath: string): boolean {
  return /^(?:default|error|layout|loading|not-found|page|template)\.[cm]?[jt]sx?$/iu.test(
    path.basename(targetPath),
  );
}

/** Resolves value and namespace imports without admitting dependencies outside the project root. */
function collectResolvedImports(
  sourceFile: ts.SourceFile,
  evidenceSourcePath: string,
  projectRoot: string,
  resolveModule: PreviewAdjacentTestContractEvidenceOptions['resolveModule'],
): {
  readonly bindings: ReadonlyMap<string, ImportedBinding>;
  readonly namespaces: ReadonlyMap<string, ImportedNamespace>;
} {
  const bindings = new Map<string, ImportedBinding>();
  const namespaces = new Map<string, ImportedNamespace>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    const importClause = statement.importClause;
    if (importClause === undefined) continue;
    const resolved = resolveModule(statement.moduleSpecifier.text, evidenceSourcePath);
    if (resolved === undefined) continue;
    const sourcePath = path.resolve(resolved);
    if (!isPathInside(projectRoot, sourcePath)) continue;
    if (importClause.name !== undefined) {
      bindings.set(importClause.name.text, { exportName: 'default', sourcePath });
    }
    const namedBindings = importClause.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      namespaces.set(namedBindings.name.text, { sourcePath });
      continue;
    }
    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue;
      bindings.set(element.name.text, {
        exportName: element.propertyName?.text ?? element.name.text,
        sourcePath,
      });
    }
  }
  return { bindings, namespaces };
}

/** Traverses standard Vitest/Jest mock calls and retains only their first complete static value. */
function collectMockExamples(
  sourceFile: ts.SourceFile,
  evidenceSourcePath: string,
  bindings: ReadonlyMap<string, ImportedBinding>,
  namespaces: ReadonlyMap<string, ImportedNamespace>,
  examples: Map<string, PreviewLearnedServerContractExample>,
): void {
  const staticScope: StaticValueScope = {
    bindings: collectTopLevelStaticBindings(sourceFile),
    undefinedIdentifiers: new Set(),
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const mode = readMockMode(node.expression.name.text);
      const receiver = unwrapExpression(node.expression.expression);
      const valueExpression = node.arguments[0];
      if (mode !== undefined && valueExpression !== undefined && ts.isCallExpression(receiver)) {
        const mockedExpression = receiver.arguments[0];
        if (mockedExpression !== undefined && isSupportedMockedHelper(receiver.expression)) {
          const binding = readMockedBinding(mockedExpression, bindings, namespaces);
          if (binding !== undefined) {
            const identity = `${path.normalize(binding.sourcePath)}\0${binding.exportName}`;
            if (!examples.has(identity)) {
              const value = readStaticContractValue(valueExpression, sourceFile, staticScope);
              if (value !== undefined) {
                examples.set(
                  identity,
                  Object.freeze({
                    evidenceSourcePath,
                    exportName: binding.exportName,
                    mode,
                    sourcePath: path.normalize(binding.sourcePath),
                    value,
                  }),
                );
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/** Learns hoisted module-factory defaults that do not require an imported test binding. */
function collectModuleFactoryMockExamples(
  sourceFile: ts.SourceFile,
  evidenceSourcePath: string,
  projectRoot: string,
  resolveModule: PreviewAdjacentTestContractEvidenceOptions['resolveModule'],
  examples: Map<string, PreviewLearnedServerContractExample>,
): void {
  const staticScope: StaticValueScope = {
    bindings: collectTopLevelStaticBindings(sourceFile),
    undefinedIdentifiers: new Set(),
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isModuleMockCall(node)) {
      const moduleSpecifier = node.arguments[0];
      const factory = node.arguments[1];
      if (
        moduleSpecifier !== undefined &&
        ts.isStringLiteral(moduleSpecifier) &&
        factory !== undefined
      ) {
        const resolved = resolveModule(moduleSpecifier.text, evidenceSourcePath);
        const sourcePath = resolved === undefined ? undefined : path.resolve(resolved);
        const factoryObject = readModuleMockFactoryObject(factory);
        if (
          sourcePath !== undefined &&
          isPathInside(projectRoot, sourcePath) &&
          factoryObject !== undefined
        ) {
          for (const property of factoryObject.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const exportName = readStaticPropertyName(property.name);
            const behavior = readModuleMockFactoryBehavior(
              property.initializer,
              sourceFile,
              staticScope,
            );
            if (exportName === undefined || behavior === undefined) continue;
            const identity = `${path.normalize(sourcePath)}\0${exportName}`;
            if (examples.has(identity)) continue;
            examples.set(
              identity,
              Object.freeze({
                evidenceSourcePath,
                exportName,
                mode: behavior.mode,
                sourcePath: path.normalize(sourcePath),
                ...(behavior.mode === 'returned-undefined' ? {} : { value: behavior.value }),
              }) as PreviewLearnedServerContractExample,
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/** Recognizes only the standard hoisted `vi.mock` and `jest.mock` module-factory APIs. */
function isModuleMockCall(call: ts.CallExpression): boolean {
  const expression = unwrapExpression(call.expression);
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    (expression.expression.text === 'vi' || expression.expression.text === 'jest') &&
    expression.name.text === 'mock'
  );
}

/** Reads one direct object returned by an inline mock factory without executing test code. */
function readModuleMockFactoryObject(
  factory: ts.Expression,
): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(factory);
  if (!ts.isArrowFunction(unwrapped) && !ts.isFunctionExpression(unwrapped)) return undefined;
  if (!ts.isBlock(unwrapped.body)) {
    const body = unwrapExpression(unwrapped.body);
    return ts.isObjectLiteralExpression(body) ? body : undefined;
  }
  const returns = unwrapped.body.statements.filter(ts.isReturnStatement);
  if (returns.length !== 1 || returns[0]?.expression === undefined) return undefined;
  const returned = unwrapExpression(returns[0].expression);
  return ts.isObjectLiteralExpression(returned) ? returned : undefined;
}

/** Maps exact mock-function defaults to an embeddable execution-contract behavior. */
function readModuleMockFactoryBehavior(
  initializer: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: StaticValueScope,
):
  | { readonly mode: 'returned-undefined' }
  | {
      readonly mode: 'resolved' | 'returned';
      readonly value: PreviewLearnedContractValue;
    }
  | undefined {
  const value = unwrapExpression(initializer);
  if (!ts.isCallExpression(value)) return undefined;
  if (isBareMockFunctionCall(value)) {
    return value.arguments.length === 0 ? { mode: 'returned-undefined' } : undefined;
  }
  if (!ts.isPropertyAccessExpression(value.expression)) return undefined;
  const mode = readMockMode(value.expression.name.text);
  const receiver = unwrapExpression(value.expression.expression);
  const valueExpression = value.arguments[0];
  if (
    mode === undefined ||
    valueExpression === undefined ||
    !ts.isCallExpression(receiver) ||
    !isBareMockFunctionCall(receiver)
  ) {
    return undefined;
  }
  const contractValue = readStaticContractValue(valueExpression, sourceFile, scope);
  return contractValue === undefined ? undefined : { mode, value: contractValue };
}

/** Recognizes a bare zero-implementation `vi.fn()` or `jest.fn()` call. */
function isBareMockFunctionCall(call: ts.CallExpression): boolean {
  const expression = unwrapExpression(call.expression);
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    (expression.expression.text === 'vi' || expression.expression.text === 'jest') &&
    expression.name.text === 'fn'
  );
}

/**
 * Expands bounded local test helpers only at statically evaluable call sites.
 *
 * ATS-style suites commonly centralize a session mock in `mockSession(role)` and invoke its
 * default from `beforeEach`. The helper declaration alone is not evidence because its parameters
 * are unresolved; the first concrete call is. Scenario-specific later calls cannot replace the
 * already retained default.
 */
function collectInvokedHelperMockExamples(
  sourceFile: ts.SourceFile,
  evidenceSourcePath: string,
  importedBindings: ReadonlyMap<string, ImportedBinding>,
  namespaces: ReadonlyMap<string, ImportedNamespace>,
  examples: Map<string, PreviewLearnedServerContractExample>,
): void {
  const helpers = collectLocalMockHelpers(sourceFile);
  if (helpers.size === 0) return;
  const topLevelBindings = collectTopLevelStaticBindings(sourceFile);
  const emptyUndefinedIdentifiers = new Set<string>();
  let expansions = 0;

  const expandHelperCall = (
    call: ts.CallExpression,
    helper: LocalMockHelper,
    parentScope: StaticValueScope,
    activeHelpers: ReadonlySet<string>,
    depth: number,
  ): void => {
    if (
      expansions >= MAXIMUM_HELPER_EXPANSIONS ||
      depth > MAXIMUM_HELPER_CALL_DEPTH ||
      activeHelpers.has(helper.name) ||
      helper.declaration.body === undefined
    ) {
      return;
    }
    const scope = bindHelperParameters(helper.declaration.parameters, call.arguments, parentScope);
    if (scope === undefined) return;
    expansions += 1;
    const nextActiveHelpers = new Set(activeHelpers);
    nextActiveHelpers.add(helper.name);

    const visitHelperNode = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        collectMockExampleFromCall(
          node,
          sourceFile,
          evidenceSourcePath,
          importedBindings,
          namespaces,
          examples,
          scope,
        );
        const nestedExpression = unwrapExpression(node.expression);
        if (ts.isIdentifier(nestedExpression)) {
          const nestedHelper = helpers.get(nestedExpression.text);
          if (nestedHelper !== undefined) {
            expandHelperCall(node, nestedHelper, scope, nextActiveHelpers, depth + 1);
            return;
          }
        }
      }
      if (ts.isFunctionDeclaration(node) && node !== helper.declaration) return;
      ts.forEachChild(node, visitHelperNode);
    };
    visitHelperNode(helper.declaration.body);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && helpers.has(node.name.text)) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const expression = unwrapExpression(node.expression);
      if (ts.isIdentifier(expression)) {
        const helper = helpers.get(expression.text);
        if (helper !== undefined) {
          expandHelperCall(
            node,
            helper,
            { bindings: topLevelBindings, undefinedIdentifiers: emptyUndefinedIdentifiers },
            new Set(),
            0,
          );
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/** Collects top-level named function declarations eligible for bounded call-site expansion. */
function collectLocalMockHelpers(sourceFile: ts.SourceFile): ReadonlyMap<string, LocalMockHelper> {
  const helpers = new Map<string, LocalMockHelper>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      statement.name === undefined ||
      statement.body === undefined ||
      statement.parameters.length > 16
    ) {
      continue;
    }
    helpers.set(statement.name.text, { declaration: statement, name: statement.name.text });
  }
  return helpers;
}

/** Retains only complete JSON-like top-level const initializers for helper argument substitution. */
function collectTopLevelStaticBindings(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, PreviewLearnedContractValue> {
  const bindings = new Map<string, PreviewLearnedContractValue>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const value = readStaticContractValue(declaration.initializer, sourceFile, {
        bindings,
        undefinedIdentifiers: new Set(),
      });
      if (value !== undefined) bindings.set(declaration.name.text, value);
    }
  }
  return bindings;
}

/** Binds simple helper parameters to complete static call arguments or known undefined values. */
function bindHelperParameters(
  parameters: readonly ts.ParameterDeclaration[],
  arguments_: readonly ts.Expression[],
  parentScope: StaticValueScope,
): StaticValueScope | undefined {
  const bindings = new Map(parentScope.bindings);
  const undefinedIdentifiers = new Set(parentScope.undefinedIdentifiers);
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    if (parameter === undefined || !ts.isIdentifier(parameter.name) || parameter.dotDotDotToken) {
      return undefined;
    }
    const argument = arguments_[index];
    const expression = argument ?? parameter.initializer;
    if (expression === undefined || isKnownUndefinedExpression(expression, parentScope)) {
      bindings.delete(parameter.name.text);
      undefinedIdentifiers.add(parameter.name.text);
      continue;
    }
    const value = readStaticContractValue(expression, expression.getSourceFile(), parentScope);
    if (value === undefined) return undefined;
    bindings.set(parameter.name.text, value);
    undefinedIdentifiers.delete(parameter.name.text);
  }
  return { bindings, undefinedIdentifiers };
}

/** Reads one supported mock call under a concrete static helper scope. */
function collectMockExampleFromCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  evidenceSourcePath: string,
  bindings: ReadonlyMap<string, ImportedBinding>,
  namespaces: ReadonlyMap<string, ImportedNamespace>,
  examples: Map<string, PreviewLearnedServerContractExample>,
  scope: StaticValueScope,
): void {
  if (!ts.isPropertyAccessExpression(node.expression)) return;
  const mode = readMockMode(node.expression.name.text);
  const receiver = unwrapExpression(node.expression.expression);
  const valueExpression = node.arguments[0];
  if (mode === undefined || valueExpression === undefined || !ts.isCallExpression(receiver)) return;
  const mockedExpression = receiver.arguments[0];
  if (mockedExpression === undefined || !isSupportedMockedHelper(receiver.expression)) return;
  const binding = readMockedBinding(mockedExpression, bindings, namespaces);
  if (binding === undefined) return;
  const identity = `${path.normalize(binding.sourcePath)}\0${binding.exportName}`;
  if (examples.has(identity)) return;
  const value = readStaticContractValue(valueExpression, sourceFile, scope);
  if (value === undefined) return;
  examples.set(
    identity,
    Object.freeze({
      evidenceSourcePath,
      exportName: binding.exportName,
      mode,
      sourcePath: path.normalize(binding.sourcePath),
      value,
    }),
  );
}

/** Maps only repeatable mock APIs to the execution behavior they prove. */
function readMockMode(
  methodName: string,
): Exclude<PreviewLearnedServerContractExample['mode'], 'returned-undefined'> | undefined {
  if (methodName === 'mockResolvedValue') return 'resolved';
  return methodName === 'mockReturnValue' ? 'returned' : undefined;
}

/** Accepts `vi.mocked`, `jest.mocked`, and an explicitly imported `mocked` helper shape. */
function isSupportedMockedHelper(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return unwrapped.text === 'mocked';
  return (
    ts.isPropertyAccessExpression(unwrapped) &&
    (unwrapped.expression.getText() === 'vi' || unwrapped.expression.getText() === 'jest') &&
    unwrapped.name.text === 'mocked'
  );
}

/** Reads either a directly imported binding or one static member of a namespace import. */
function readMockedBinding(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, ImportedBinding>,
  namespaces: ReadonlyMap<string, ImportedNamespace>,
): ImportedBinding | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return bindings.get(unwrapped.text);
  if (!ts.isPropertyAccessExpression(unwrapped) || !ts.isIdentifier(unwrapped.expression)) {
    return undefined;
  }
  const namespace = namespaces.get(unwrapped.expression.text);
  return namespace === undefined
    ? undefined
    : { exportName: unwrapped.name.text, sourcePath: namespace.sourcePath };
}

/** Parses one complete JSON-like expression within strict depth, node, and byte ceilings. */
function readStaticContractValue(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: StaticValueScope = { bindings: new Map(), undefinedIdentifiers: new Set() },
): PreviewLearnedContractValue | undefined {
  const value = parseStaticValue(expression, sourceFile, { nodes: 0 }, 0, scope);
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  return Buffer.byteLength(serialized, 'utf8') <= MAXIMUM_SERIALIZED_VALUE_BYTES
    ? freezeContractValue(value)
    : undefined;
}

/** Recursively parses literals while failing the entire value on any dynamic child. */
function parseStaticValue(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  budget: LiteralBudget,
  depth: number,
  scope: StaticValueScope,
): PreviewLearnedContractValue | undefined {
  budget.nodes += 1;
  if (budget.nodes > MAXIMUM_LITERAL_NODES || depth > MAXIMUM_LITERAL_DEPTH) return undefined;
  const node = unwrapExpression(expression);
  if (ts.isIdentifier(node)) return scope.bindings.get(node.text);
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.length <= MAXIMUM_LITERAL_STRING_LENGTH ? node.text : undefined;
  }
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text.replaceAll('_', ''));
    return Number.isFinite(value) ? value : undefined;
  }
  if (ts.isPrefixUnaryExpression(node)) {
    const operand = parseStaticValue(node.operand, sourceFile, budget, depth + 1, scope);
    if (typeof operand !== 'number') return undefined;
    if (node.operator === ts.SyntaxKind.MinusToken) return -operand;
    return node.operator === ts.SyntaxKind.PlusToken ? operand : undefined;
  }
  if (ts.isArrayLiteralExpression(node)) {
    if (node.elements.length > MAXIMUM_LITERAL_COLLECTION_ITEMS) return undefined;
    const values: PreviewLearnedContractValue[] = [];
    for (const element of node.elements) {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return undefined;
      const value = parseStaticValue(element, sourceFile, budget, depth + 1, scope);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }
  if (ts.isObjectLiteralExpression(node)) {
    if (node.properties.length > MAXIMUM_LITERAL_COLLECTION_ITEMS) return undefined;
    const value: Record<string, PreviewLearnedContractValue> = Object.create(null) as Record<
      string,
      PreviewLearnedContractValue
    >;
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        return undefined;
      }
      const propertyName = readStaticPropertyName(property.name);
      if (propertyName === undefined || Object.hasOwn(value, propertyName)) return undefined;
      const propertyValue = ts.isShorthandPropertyAssignment(property)
        ? scope.bindings.get(property.name.text)
        : parseStaticValue(property.initializer, sourceFile, budget, depth + 1, scope);
      if (propertyValue === undefined) return undefined;
      value[propertyName] = propertyValue;
    }
    return value;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  ) {
    const left = parseStaticValue(node.left, sourceFile, budget, depth + 1, scope);
    if (left !== undefined && left !== null) return left;
    if (left === undefined && !isKnownUndefinedExpression(node.left, scope)) return undefined;
    return parseStaticValue(node.right, sourceFile, budget, depth + 1, scope);
  }
  return undefined;
}

/** Distinguishes a proven missing helper argument from an unsupported dynamic expression. */
function isKnownUndefinedExpression(expression: ts.Expression, scope: StaticValueScope): boolean {
  const node = unwrapExpression(expression);
  if (
    ts.isIdentifier(node) &&
    (node.text === 'undefined' || scope.undefinedIdentifiers.has(node.text))
  ) {
    return true;
  }
  if (!ts.isVoidExpression(node)) return false;
  const operand = unwrapExpression(node.expression);
  return ts.isNumericLiteral(operand) && operand.text === '0';
}

/** Unwraps syntax-only TypeScript wrappers without evaluating the contained expression. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Reads a non-computed object key accepted by JSON serialization. */
function readStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** Deep-freezes a parsed value before it crosses into the immutable hint plan. */
function freezeContractValue(value: PreviewLearnedContractValue): PreviewLearnedContractValue {
  if (isLearnedContractArray(value)) {
    return Object.freeze(value.map((item) => freezeContractValue(item)));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, PreviewLearnedContractValue>>;
    return Object.freeze(
      Object.fromEntries(
        Object.entries(record).map(([key, item]) => [key, freezeContractValue(item)]),
      ),
    );
  }
  return value;
}

/** Narrows the recursive readonly array branch without leaking `Array.isArray`'s `any[]` type. */
function isLearnedContractArray(
  value: PreviewLearnedContractValue,
): value is readonly PreviewLearnedContractValue[] {
  return Array.isArray(value);
}

/** Reads an editor overlay first and falls back to the colocated test file. */
async function readEvidenceSource(
  sourcePath: string,
  readSource: PreviewAdjacentTestContractEvidenceOptions['readSource'],
): Promise<string | undefined> {
  try {
    return (await readSource?.(sourcePath)) ?? (await readFile(sourcePath, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Selects the TypeScript parser mode from the test suffix. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  return extension === '.js' || extension === '.mjs' || extension === '.cjs'
    ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
}

/** Segment-aware containment prevents adjacent discovery from escaping the active project. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Escapes a target stem before using it in an adjacent-test filename pattern. */
function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
