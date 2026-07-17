/**
 * Finds syntax-proven ReactDOM mount calls in an already parsed application source file.
 *
 * Entry discovery is deliberately narrower than general call-graph analysis. A call is accepted
 * only when its callee resolves lexically to an ES import from `react-dom/client` or `react-dom`,
 * or to a `const` root created by such an import. Project modules are never loaded or evaluated.
 * The resulting evidence lets a later render-graph stage connect authored components to the real
 * browser entry without treating arbitrary methods named `render` as application roots.
 */
import ts from 'typescript';

/** ReactDOM mounting APIs that are safe to identify from import-backed syntax alone. */
export type PreviewEntryPointEvidenceKind = 'create-root' | 'hydrate-root' | 'legacy-render';

/** One statically proven ReactDOM mount and the component spellings visible in its JSX argument. */
export interface PreviewEntryPointEvidence {
  /** Modern create-root, modern/legacy hydration, or the legacy render API. */
  readonly kind: PreviewEntryPointEvidenceKind;
  /** Source offset of the complete mount call, used for deterministic graph edges. */
  readonly occurrenceStart: number;
  /** Root identifier spellings referenced by the JSX, ordered by first source occurrence. */
  readonly referencedLocalNames: readonly string[];
  /** Component-like JSX tag paths in depth-first outer-to-inner order. */
  readonly wrapperNames: readonly string[];
  /** Authored source path supplied by the bounded project inventory. */
  readonly sourcePath: string;
}

/** Internal identity assigned only to runtime-bearing ReactDOM import bindings. */
type ReactDomBindingKind =
  | 'client-create-root'
  | 'client-hydrate-root'
  | 'client-namespace'
  | 'legacy-hydrate'
  | 'legacy-namespace'
  | 'legacy-render';

/** A lexical scope retained as source ranges so callers need not enable TypeScript parent links. */
interface BindingScope {
  readonly depth: number;
  readonly end: number;
  readonly start: number;
}

/** One value-space declaration that may shadow a ReactDOM import or identify an assigned root. */
interface BindingRecord {
  readonly declaration: ts.Identifier;
  readonly name: string;
  readonly scope: BindingScope;
  reactDomKind?: ReactDomBindingKind;
  rootKind?: 'create-root';
}

/** A simple `const` candidate classified after every lexical shadow is known. */
interface RootBindingCandidate {
  readonly initializer: ts.Expression;
  readonly record: BindingRecord;
}

/** Complete syntax-only binding inventory for one source file. */
interface BindingRegistry {
  readonly declarations: ReadonlySet<ts.Identifier>;
  readonly recordsByName: ReadonlyMap<string, readonly BindingRecord[]>;
  readonly rootCandidates: readonly RootBindingCandidate[];
}

/** A mount classification paired with the API-specific JSX argument position. */
interface ClassifiedMountCall {
  readonly argumentIndex: number;
  readonly kind: PreviewEntryPointEvidenceKind;
}

/** Accumulates stable unique strings while preserving authored traversal order. */
interface OrderedNames {
  readonly names: string[];
  readonly seen: Set<string>;
}

/** Context propagated through the declaration inventory traversal. */
interface BindingTraversalContext {
  readonly functionScope: BindingScope;
  readonly lexicalScope: BindingScope;
}

/** Mutable construction state hidden behind the immutable binding registry contract. */
interface BindingRegistryBuilder {
  readonly declarations: Set<ts.Identifier>;
  readonly recordsByName: Map<string, BindingRecord[]>;
  readonly rootCandidates: RootBindingCandidate[];
}

/**
 * Collects every import-backed ReactDOM mount whose rendered value is syntactically JSX.
 *
 * Alias imports, namespace imports, default `react-dom` imports, direct create-root chains, and
 * `const root = createRoot(...); root.render(...)` are supported. Mutable roots, shadowed imports,
 * computed member access, non-JSX render values, and lookalike local functions fail closed.
 *
 * @param sourcePath Authored path associated with `sourceFile`.
 * @param sourceFile Parsed TypeScript or JavaScript source; no type checker is required.
 * @returns Frozen evidence ordered by mount-call occurrence.
 */
export function collectPreviewEntryPointEvidence(
  sourcePath: string,
  sourceFile: ts.SourceFile,
): readonly PreviewEntryPointEvidence[] {
  const registry = createBindingRegistry(sourceFile);
  classifyConstRootBindings(registry);
  const evidence: PreviewEntryPointEvidence[] = [];

  /** Visits calls once and records only those with an import-proven ReactDOM identity. */
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const classification = classifyMountCall(node, registry);
      const argument =
        classification === undefined ? undefined : node.arguments[classification.argumentIndex];
      const jsxArgument = argument === undefined ? undefined : readJsxArgument(argument);
      if (classification !== undefined && jsxArgument !== undefined) {
        const names = collectRenderedNames(jsxArgument, sourceFile, registry);
        evidence.push(
          Object.freeze({
            kind: classification.kind,
            occurrenceStart: node.getStart(sourceFile),
            referencedLocalNames: Object.freeze(names.referencedLocalNames),
            sourcePath,
            wrapperNames: Object.freeze(names.wrapperNames),
          }),
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  evidence.sort((left, right) => left.occurrenceStart - right.occurrenceStart);
  return Object.freeze(evidence);
}

/**
 * Builds lexical value bindings before classifying calls, preventing a nested local declaration
 * from borrowing the authority of an outer ReactDOM import with the same spelling.
 *
 * @param sourceFile Source whose declarations define the available lexical identities.
 * @returns Immutable registry plus deferred create-root `const` candidates.
 */
function createBindingRegistry(sourceFile: ts.SourceFile): BindingRegistry {
  const builder: BindingRegistryBuilder = {
    declarations: new Set(),
    recordsByName: new Map(),
    rootCandidates: [],
  };
  const sourceScope = createScope(sourceFile, 0);
  visitBindings(sourceFile, { functionScope: sourceScope, lexicalScope: sourceScope }, builder);
  return {
    declarations: builder.declarations,
    recordsByName: builder.recordsByName,
    rootCandidates: builder.rootCandidates,
  };
}

/**
 * Traverses declarations with explicit lexical/function scopes and records value-space shadows.
 * The traversal does not depend on `node.parent`, so it also accepts lightweight SourceFiles made
 * with `setParentNodes: false`.
 *
 * @param node Current syntax node.
 * @param context Nearest lexical and function scopes.
 * @param builder Mutable registry construction state.
 */
function visitBindings(
  node: ts.Node,
  context: BindingTraversalContext,
  builder: BindingRegistryBuilder,
): void {
  if (ts.isImportDeclaration(node)) {
    collectImportBindings(node, context.lexicalScope, builder);
    return;
  }

  let nextContext = context;
  if (isFunctionLikeDeclaration(node)) {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      addBinding(node.name, context.lexicalScope, builder);
    }
    const functionScope = createScope(node, context.lexicalScope.depth + 1);
    nextContext = { functionScope, lexicalScope: functionScope };
    if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name !== undefined) {
      addBinding(node.name, functionScope, builder);
    }
    for (const parameter of node.parameters) {
      addBindingName(parameter.name, functionScope, builder);
    }
  } else if (ts.isClassDeclaration(node)) {
    if (node.name !== undefined) {
      addBinding(node.name, context.lexicalScope, builder);
    }
    const classScope = createScope(node, context.lexicalScope.depth + 1);
    nextContext = { ...context, lexicalScope: classScope };
  } else if (ts.isClassExpression(node)) {
    const classScope = createScope(node, context.lexicalScope.depth + 1);
    nextContext = { ...context, lexicalScope: classScope };
    if (node.name !== undefined) {
      addBinding(node.name, classScope, builder);
    }
  } else if (isLexicalScopeNode(node) && !ts.isSourceFile(node)) {
    const lexicalScope = createScope(node, context.lexicalScope.depth + 1);
    nextContext = { ...context, lexicalScope };
    if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      addBindingName(node.variableDeclaration.name, lexicalScope, builder);
    }
  } else if (
    (ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) &&
    ts.isIdentifier(node.name)
  ) {
    addBinding(node.name, context.lexicalScope, builder);
  }

  if (ts.isVariableDeclarationList(node)) {
    collectVariableBindings(node, nextContext, builder);
  }
  ts.forEachChild(node, (child) => {
    visitBindings(child, nextContext, builder);
  });
}

/**
 * Records runtime ES import bindings and assigns ReactDOM authority only to exact package exports.
 * Type-only clauses are ignored because they do not create browser values.
 *
 * @param declaration Import declaration being inspected.
 * @param scope Source-file lexical scope.
 * @param builder Registry construction state.
 */
function collectImportBindings(
  declaration: ts.ImportDeclaration,
  scope: BindingScope,
  builder: BindingRegistryBuilder,
): void {
  const moduleSpecifier = ts.isStringLiteralLike(declaration.moduleSpecifier)
    ? declaration.moduleSpecifier.text
    : undefined;
  const clause = declaration.importClause;
  if (
    moduleSpecifier === undefined ||
    clause === undefined ||
    clause.phaseModifier === ts.SyntaxKind.TypeKeyword
  ) {
    return;
  }

  if (clause.name !== undefined) {
    const record = addBinding(clause.name, scope, builder);
    if (moduleSpecifier === 'react-dom') {
      record.reactDomKind = 'legacy-namespace';
    }
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined) {
    return;
  }
  if (ts.isNamespaceImport(bindings)) {
    const record = addBinding(bindings.name, scope, builder);
    if (moduleSpecifier === 'react-dom/client') {
      record.reactDomKind = 'client-namespace';
    } else if (moduleSpecifier === 'react-dom') {
      record.reactDomKind = 'legacy-namespace';
    }
    return;
  }

  for (const element of bindings.elements) {
    if (element.isTypeOnly) {
      continue;
    }
    const record = addBinding(element.name, scope, builder);
    const importedName = element.propertyName?.text ?? element.name.text;
    const reactDomKind = classifyNamedImport(moduleSpecifier, importedName);
    if (reactDomKind !== undefined) {
      record.reactDomKind = reactDomKind;
    }
  }
}

/**
 * Maps exact named package exports to supported runtime identities.
 *
 * @param moduleSpecifier Literal package specifier.
 * @param importedName Original exported member before local aliasing.
 * @returns Supported identity, or `undefined` for unrelated imports.
 */
function classifyNamedImport(
  moduleSpecifier: string,
  importedName: string,
): ReactDomBindingKind | undefined {
  if (moduleSpecifier === 'react-dom/client') {
    if (importedName === 'createRoot') {
      return 'client-create-root';
    }
    if (importedName === 'hydrateRoot') {
      return 'client-hydrate-root';
    }
  }
  if (moduleSpecifier === 'react-dom') {
    if (importedName === 'render') {
      return 'legacy-render';
    }
    if (importedName === 'hydrate') {
      return 'legacy-hydrate';
    }
  }
  return undefined;
}

/**
 * Records variable value bindings in their actual block or function scope and defers simple const
 * root classification until all shadows have been inventoried.
 *
 * @param list Variable declaration list.
 * @param context Current lexical/function scopes.
 * @param builder Registry construction state.
 */
function collectVariableBindings(
  list: ts.VariableDeclarationList,
  context: BindingTraversalContext,
  builder: BindingRegistryBuilder,
): void {
  const isBlockScoped = (list.flags & ts.NodeFlags.BlockScoped) !== 0;
  const isConst = (list.flags & ts.NodeFlags.Const) !== 0;
  const scope = isBlockScoped ? context.lexicalScope : context.functionScope;
  for (const declaration of list.declarations) {
    const records = addBindingName(declaration.name, scope, builder);
    if (isConst && ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
      const record = records[0];
      if (record !== undefined) {
        builder.rootCandidates.push({ initializer: declaration.initializer, record });
      }
    }
  }
}

/**
 * Adds every identifier from a simple or destructured binding name.
 *
 * @param name Binding syntax to flatten.
 * @param scope Scope owning all flattened identifiers.
 * @param builder Registry construction state.
 * @returns Records added in syntax order.
 */
function addBindingName(
  name: ts.BindingName,
  scope: BindingScope,
  builder: BindingRegistryBuilder,
): readonly BindingRecord[] {
  if (ts.isIdentifier(name)) {
    return [addBinding(name, scope, builder)];
  }
  const records: BindingRecord[] = [];
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }
    records.push(...addBindingName(element.name, scope, builder));
  }
  return records;
}

/**
 * Inserts one declaration into the name-indexed lexical registry.
 *
 * @param declaration Declared identifier node.
 * @param scope Owning lexical scope.
 * @param builder Registry construction state.
 * @returns Mutable record whose ReactDOM/root identity may be classified later.
 */
function addBinding(
  declaration: ts.Identifier,
  scope: BindingScope,
  builder: BindingRegistryBuilder,
): BindingRecord {
  const record: BindingRecord = { declaration, name: declaration.text, scope };
  const records = builder.recordsByName.get(record.name) ?? [];
  records.push(record);
  builder.recordsByName.set(record.name, records);
  builder.declarations.add(declaration);
  return record;
}

/**
 * Promotes only simple const bindings initialized by an import-proven createRoot call.
 *
 * @param registry Complete lexical registry.
 */
function classifyConstRootBindings(registry: BindingRegistry): void {
  for (const candidate of registry.rootCandidates) {
    const initializer = unwrapExpression(candidate.initializer);
    if (
      ts.isCallExpression(initializer) &&
      initializer.arguments.length > 0 &&
      isCreateRootFactoryCall(initializer, registry)
    ) {
      candidate.record.rootKind = 'create-root';
    }
  }
}

/**
 * Classifies one call as a supported mount and records where that API receives its JSX value.
 *
 * @param call Candidate call expression.
 * @param registry Lexical identities used to reject shadowed lookalikes.
 * @returns API kind and render-argument index when proven.
 */
function classifyMountCall(
  call: ts.CallExpression,
  registry: BindingRegistry,
): ClassifiedMountCall | undefined {
  const importedKind = readImportedCallKind(call.expression, registry);
  if (importedKind === 'client-hydrate-root') {
    return { argumentIndex: 1, kind: 'hydrate-root' };
  }
  if (importedKind === 'legacy-hydrate') {
    return { argumentIndex: 0, kind: 'hydrate-root' };
  }
  if (importedKind === 'legacy-render') {
    return { argumentIndex: 0, kind: 'legacy-render' };
  }

  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'render') {
    return undefined;
  }
  const receiver = unwrapExpression(callee.expression);
  if (
    ts.isCallExpression(receiver) &&
    receiver.arguments.length > 0 &&
    isCreateRootFactoryCall(receiver, registry)
  ) {
    return { argumentIndex: 0, kind: 'create-root' };
  }
  if (ts.isIdentifier(receiver)) {
    const binding = resolveBinding(receiver, registry);
    if (binding?.rootKind === 'create-root' && binding.declaration.pos < receiver.pos) {
      return { argumentIndex: 0, kind: 'create-root' };
    }
  }
  return undefined;
}

/**
 * Tests whether a call invokes the exact imported createRoot factory.
 *
 * @param call Factory call candidate.
 * @param registry Lexical import identities.
 * @returns Whether the callee resolves to `react-dom/client#createRoot`.
 */
function isCreateRootFactoryCall(call: ts.CallExpression, registry: BindingRegistry): boolean {
  return readImportedCallKind(call.expression, registry) === 'client-create-root';
}

/**
 * Resolves a direct named call or namespace member call to an exact ReactDOM import identity.
 * Property names are accepted only when the receiver itself resolves to the matching namespace.
 *
 * @param expression Call callee.
 * @param registry Lexical binding registry.
 * @returns ReactDOM identity when import-backed.
 */
function readImportedCallKind(
  expression: ts.Expression,
  registry: BindingRegistry,
): ReactDomBindingKind | undefined {
  const callee = unwrapExpression(expression);
  if (ts.isIdentifier(callee)) {
    return resolveBinding(callee, registry)?.reactDomKind;
  }
  if (!ts.isPropertyAccessExpression(callee)) {
    return undefined;
  }
  const receiver = unwrapExpression(callee.expression);
  if (!ts.isIdentifier(receiver)) {
    return undefined;
  }
  const namespaceKind = resolveBinding(receiver, registry)?.reactDomKind;
  if (namespaceKind === 'client-namespace') {
    return classifyNamedImport('react-dom/client', callee.name.text);
  }
  if (namespaceKind === 'legacy-namespace') {
    return classifyNamedImport('react-dom', callee.name.text);
  }
  return undefined;
}

/**
 * Resolves one identifier to its nearest unique lexical declaration. Duplicate declarations in the
 * same scope are treated as ambiguous and therefore cannot prove a mount.
 *
 * @param reference Identifier use to resolve.
 * @param registry Complete value binding inventory.
 * @returns Nearest unique binding, if any.
 */
function resolveBinding(
  reference: ts.Identifier,
  registry: BindingRegistry,
): BindingRecord | undefined {
  const records = registry.recordsByName.get(reference.text) ?? [];
  const start = reference.pos;
  const containing = records.filter(
    (record) => record.scope.start <= start && record.scope.end >= reference.end,
  );
  const deepest = containing.reduce((maximum, record) => Math.max(maximum, record.scope.depth), -1);
  const nearest = containing.filter((record) => record.scope.depth === deepest);
  return nearest.length === 1 ? nearest[0] : undefined;
}

/**
 * Extracts an actual JSX value through transparent TypeScript expression wrappers.
 *
 * @param expression API argument to inspect.
 * @returns JSX element/fragment, or `undefined` for non-JSX runtime values.
 */
function readJsxArgument(
  expression: ts.Expression,
): ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement | undefined {
  const unwrapped = unwrapExpression(expression);
  return ts.isJsxElement(unwrapped) ||
    ts.isJsxFragment(unwrapped) ||
    ts.isJsxSelfClosingElement(unwrapped)
    ? unwrapped
    : undefined;
}

/**
 * Removes syntax wrappers that do not change a callee or JSX value at runtime.
 *
 * @param expression Expression to normalize.
 * @returns Innermost runtime expression.
 */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Collects component tag paths and free/root value identifiers from rendered JSX. Property names,
 * intrinsic tags, type syntax, and bindings declared inside the JSX argument are intentionally
 * omitted because they cannot identify an outer application component or bootstrap value.
 *
 * @param jsx Rendered JSX root.
 * @param sourceFile Source used for exact authored tag spellings.
 * @param registry Lexical bindings used to remove expression-local parameters.
 * @returns Stable ordered component and identifier names.
 */
function collectRenderedNames(
  jsx: ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
  registry: BindingRegistry,
): { readonly referencedLocalNames: string[]; readonly wrapperNames: string[] } {
  const references = createOrderedNames();
  const wrappers = createOrderedNames();
  const argumentStart = jsx.getStart(sourceFile);
  const argumentEnd = jsx.end;

  /** Adds a value identifier unless its declaration is local to the rendered expression itself. */
  const addReference = (identifier: ts.Identifier): void => {
    const binding = resolveBinding(identifier, registry);
    if (
      binding !== undefined &&
      binding.declaration.getStart(sourceFile) >= argumentStart &&
      binding.declaration.end <= argumentEnd
    ) {
      return;
    }
    addOrderedName(references, identifier.text);
  };

  /** Traverses only runtime-bearing JSX and expression children in authored source order. */
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) {
      return;
    }
    if (ts.isJsxElement(node)) {
      collectJsxTag(node.openingElement.tagName, sourceFile, wrappers, addReference);
      collectJsxAttributes(node.openingElement.attributes, visit);
      for (const child of node.children) {
        visit(child);
      }
      return;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      collectJsxTag(node.tagName, sourceFile, wrappers, addReference);
      collectJsxAttributes(node.attributes, visit);
      return;
    }
    if (ts.isJsxFragment(node)) {
      for (const child of node.children) {
        visit(child);
      }
      return;
    }
    if (ts.isJsxExpression(node)) {
      if (node.expression !== undefined) {
        visit(node.expression);
      }
      return;
    }
    if (ts.isJsxText(node)) {
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      if (ts.isComputedPropertyName(node.name)) {
        visit(node.name.expression);
      }
      visit(node.initializer);
      return;
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      addReference(node.name);
      if (node.objectAssignmentInitializer !== undefined) {
        visit(node.objectAssignmentInitializer);
      }
      return;
    }
    if (
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isParenthesizedExpression(node)
    ) {
      visit(node.expression);
      return;
    }
    if (ts.isIdentifier(node)) {
      if (!registry.declarations.has(node)) {
        addReference(node);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(jsx);
  return { referencedLocalNames: references.names, wrapperNames: wrappers.names };
}

/**
 * Adds one component-like JSX tag and its root value identifier. Lowercase intrinsic tags are
 * omitted, while member paths such as `Theme.Provider` retain their authored dotted spelling.
 *
 * @param tagName JSX tag syntax.
 * @param sourceFile Source used for exact text.
 * @param wrappers Ordered wrapper accumulator.
 * @param addReference Callback for the root value identifier.
 */
function collectJsxTag(
  tagName: ts.JsxTagNameExpression,
  sourceFile: ts.SourceFile,
  wrappers: OrderedNames,
  addReference: (identifier: ts.Identifier) => void,
): void {
  const rootIdentifier = readJsxRootIdentifier(tagName);
  const isMemberTag = ts.isPropertyAccessExpression(tagName);
  if (rootIdentifier === undefined || (!isMemberTag && /^[a-z]/u.test(rootIdentifier.text))) {
    return;
  }
  addOrderedName(wrappers, tagName.getText(sourceFile));
  addReference(rootIdentifier);
}

/**
 * Traverses JSX attribute values without treating attribute/property spellings as references.
 *
 * @param attributes JSX attributes attached to one component or intrinsic element.
 * @param visit Runtime-expression visitor.
 */
function collectJsxAttributes(attributes: ts.JsxAttributes, visit: (node: ts.Node) => void): void {
  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      visit(property.expression);
      continue;
    }
    const initializer = property.initializer;
    if (initializer !== undefined && ts.isJsxExpression(initializer)) {
      visit(initializer);
    }
  }
}

/**
 * Finds the local root identifier of an identifier or dotted JSX member tag.
 *
 * @param tagName JSX tag path.
 * @returns Root local identifier, excluding `this` and namespaced intrinsic syntax.
 */
function readJsxRootIdentifier(tagName: ts.JsxTagNameExpression): ts.Identifier | undefined {
  if (ts.isIdentifier(tagName)) {
    return tagName;
  }
  if (ts.isPropertyAccessExpression(tagName)) {
    const expression = tagName.expression;
    return ts.isIdentifier(expression) ? expression : readJsxRootIdentifier(expression);
  }
  return undefined;
}

/** Creates an empty ordered unique-name accumulator. */
function createOrderedNames(): OrderedNames {
  return { names: [], seen: new Set() };
}

/**
 * Adds one non-empty name once while retaining first-occurrence order.
 *
 * @param ordered Accumulator to update.
 * @param name Identifier or tag spelling.
 */
function addOrderedName(ordered: OrderedNames, name: string): void {
  if (name.length === 0 || ordered.seen.has(name)) {
    return;
  }
  ordered.seen.add(name);
  ordered.names.push(name);
}

/**
 * Creates a source-range scope at a stable lexical depth.
 *
 * @param node Syntax node owning the scope.
 * @param depth Nesting depth used for nearest-binding selection.
 * @returns Range-based scope record.
 */
function createScope(node: ts.Node, depth: number): BindingScope {
  return { depth, end: node.end, start: node.pos };
}

/**
 * Identifies function-like declarations that own parameters and var bindings.
 *
 * @param node Syntax node to classify.
 * @returns Whether the node creates a function value scope.
 */
function isFunctionLikeDeclaration(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

/**
 * Identifies block-like nodes that own block-scoped variables.
 *
 * @param node Syntax node to classify.
 * @returns Whether descendants receive a nested lexical scope.
 */
function isLexicalScopeNode(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isModuleBlock(node)
  );
}
