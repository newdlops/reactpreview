/**
 * Removes statically dormant project overlays from the provisional first-paint graph.
 *
 * The transform is intentionally strict. It rewrites an import only when every reference resolves
 * to the exact imported binding, every JSX use is hidden by a lexical React `useState` boolean or a
 * literal, and no JSX spread can override visibility. Fast preparation may cross a package whose
 * manifest omits `sideEffects` only when the caller explicitly opts into a provisional boundary;
 * the subsequent full preparation never enables this transform and restores exact module effects.
 */
import path from 'node:path';
import ts from 'typescript';

const OVERLAY_NAME_PATTERN =
  /(?:modal|dialog|drawer|popover|popper|overlay|portal|sheet|lightbox)$/iu;
const POSITIVE_VISIBILITY_PROPS = new Set([
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
const NEGATIVE_VISIBILITY_PROPS = new Set(['hidden', 'ishidden']);

/** Project-aware resolution and inert package metadata supplied by the compiler. */
export interface PreviewDormantOverlayResolver {
  /** Proves that delaying this exact module cannot suppress authored top-level effects. */
  readonly isSideEffectFree?: (resolvedPath: string) => boolean;
  /** Resolves an authored import without loading or evaluating its module. */
  readonly resolve: (specifier: string, importerPath: string) => string | undefined;
}

/** Inputs needed to prove that a dormant component belongs to the trusted workspace. */
export interface PreviewDormantOverlayDeferralOptions {
  /** Allows a fast-only placeholder when a workspace package omits side-effect metadata. */
  readonly allowProvisionalSideEffectDeferral?: boolean;
  /** Exact compiler resolver shared with the eventual esbuild graph. */
  readonly resolver: PreviewDormantOverlayResolver;
  /** Absolute source identity used for parser grammar and relative resolution. */
  readonly sourcePath: string;
  /** Current editor or filesystem source. */
  readonly sourceText: string;
  /** Trusted workspace boundary; dependency packages are never substituted. */
  readonly workspaceRoot: string;
}

/** One imported runtime component whose exact export can be loaded on first visible render. */
interface OverlayImportBinding {
  readonly declaration: ts.ImportDeclaration;
  readonly exportName: string;
  readonly localName: string;
  readonly node: ts.Identifier;
  readonly specifier: string;
}

/** Import declaration plus the subset of runtime bindings proven dormant. */
interface DeferredImportPlan {
  readonly bindings: readonly OverlayImportBinding[];
  readonly declaration: ts.ImportDeclaration;
}

/** Half-open source edit applied from the end of the file toward the beginning. */
interface SourceEdit {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
}

/** Lexical scopes required to distinguish same-spelled state and component bindings. */
type LexicalScope =
  | ts.Block
  | ts.CaseBlock
  | ts.CatchClause
  | ts.ForInStatement
  | ts.ForOfStatement
  | ts.ForStatement
  | ts.FunctionLikeDeclaration
  | ts.SourceFile;

/** One exact declaration identity and an optional proven React state initializer. */
interface LexicalBindingRecord {
  initialBoolean?: boolean;
  readonly node: ts.Identifier;
}

/** Immutable-enough binding lookup built once for one transformed source file. */
interface LexicalBindingIndex {
  readonly bindingsByScope: ReadonlyMap<
    LexicalScope,
    ReadonlyMap<string, readonly LexicalBindingRecord[]>
  >;
  readonly recordByNode: ReadonlyMap<ts.Identifier, LexicalBindingRecord>;
  readonly reactStateBindings: ReadonlySet<ts.Identifier>;
}

/** Generated React aliases shared by every deferred import replacement in one source module. */
interface DeferredReactBindings {
  readonly createElement: string;
  readonly forwardRef: string;
}

/** Allocates generated identifiers while retaining authored and previously generated names. */
class GeneratedBindingAllocator {
  private readonly allocated = new Set<string>();

  /** Seeds collision checks with the complete authored source text. */
  public constructor(private readonly sourceText: string) {}

  /** Returns one deterministic collision-free module binding. */
  public next(baseName: string): string {
    let candidate = baseName;
    let suffix = 2;
    while (
      this.allocated.has(candidate) ||
      new RegExp(`\\b${candidate}\\b`, 'u').test(this.sourceText)
    ) {
      candidate = `${baseName}${suffix.toString()}`;
      suffix += 1;
    }
    this.allocated.add(candidate);
    return candidate;
  }
}

/**
 * Replaces safe dormant imports with visibility-aware `React.lazy` wrappers.
 * Full builds never enable this transform. Fast builds retain source line counts so Inspector
 * locations after an import continue to address the authored editor document.
 */
export function deferPreviewDormantOverlayImports(
  options: PreviewDormantOverlayDeferralOptions,
): string {
  if (!mayContainDormantOverlay(options.sourceText)) return options.sourceText;
  const sourceFile = ts.createSourceFile(
    options.sourcePath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(options.sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return options.sourceText;

  const bindingIndex = createLexicalBindingIndex(sourceFile);
  const candidates = collectOverlayImportBindings(sourceFile, options);
  const deferred = candidates.filter((binding) =>
    isBindingUsedOnlyByDormantJsx(binding, sourceFile, bindingIndex),
  );
  if (deferred.length === 0) return options.sourceText;

  const allocator = new GeneratedBindingAllocator(options.sourceText);
  const react: DeferredReactBindings = {
    createElement: allocator.next('__reactPreviewCreateElement'),
    forwardRef: allocator.next('__reactPreviewForwardRef'),
  };
  const edits = groupBindingsByDeclaration(deferred).map((plan, index) =>
    createImportReplacement(plan, sourceFile, react, allocator, index === 0),
  );
  return applySourceEdits(options.sourceText, edits);
}

/** Avoids allocating a TypeScript tree for ordinary modules without overlay visibility syntax. */
function mayContainDormantOverlay(sourceText: string): boolean {
  return (
    sourceText.includes('<') &&
    (sourceText.includes('false') ||
      sourceText.includes('true') ||
      /\b(?:hidden|isHidden)(?:\s|\/|>)/u.test(sourceText)) &&
    /(?:Modal|Dialog|Drawer|Popover|Popper|Overlay|Portal|Sheet|Lightbox)\b/u.test(sourceText) &&
    (/\b(?:active|defaultOpen|defaultVisible|expanded|hidden|isHidden|isOpen|isVisible|open|present|show|shown|visible)\s*=/u.test(
      sourceText,
    ) ||
      /\b(?:hidden|isHidden)(?:\s|\/|>)/u.test(sourceText))
  );
}

/** Builds lexical declaration identities before attaching proven React state initializers. */
function createLexicalBindingIndex(sourceFile: ts.SourceFile): LexicalBindingIndex {
  const mutable = new Map<LexicalScope, Map<string, LexicalBindingRecord[]>>();
  const recordByNode = new Map<ts.Identifier, LexicalBindingRecord>();
  const reactStateBindings = new Set<ts.Identifier>();

  /** Registers every identifier in one declaration pattern under its actual lexical scope. */
  const registerPattern = (name: ts.BindingName, scope: LexicalScope): void => {
    if (ts.isIdentifier(name)) {
      registerLexicalBinding(mutable, recordByNode, scope, name);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) registerPattern(element.name, scope);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause !== undefined) {
      const clause = node.importClause;
      if (clause.name !== undefined)
        registerLexicalBinding(mutable, recordByNode, sourceFile, clause.name);
      const named = clause.namedBindings;
      if (named !== undefined && ts.isNamespaceImport(named)) {
        registerLexicalBinding(mutable, recordByNode, sourceFile, named.name);
      } else if (named !== undefined && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          if (ts.isIdentifier(element.name)) {
            registerLexicalBinding(mutable, recordByNode, sourceFile, element.name);
          }
        }
      }
      if (ts.isStringLiteralLike(node.moduleSpecifier) && node.moduleSpecifier.text === 'react') {
        if (clause.name !== undefined) reactStateBindings.add(clause.name);
        if (named !== undefined && ts.isNamespaceImport(named)) reactStateBindings.add(named.name);
        if (named !== undefined && ts.isNamedImports(named)) {
          for (const element of named.elements) {
            const importedName = (element.propertyName ?? element.name).text;
            if (importedName === 'useState' && ts.isIdentifier(element.name)) {
              reactStateBindings.add(element.name);
            }
          }
        }
      }
    } else if (ts.isVariableDeclaration(node)) {
      registerPattern(node.name, findVariableScope(node));
    } else if (ts.isParameter(node)) {
      const owner = findNearestFunction(node);
      if (owner !== undefined) registerPattern(node.name, owner);
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name !== undefined
    ) {
      registerLexicalBinding(mutable, recordByNode, findNearestOuterLexicalScope(node), node.name);
    } else if (ts.isFunctionExpression(node) && node.name !== undefined) {
      registerLexicalBinding(mutable, recordByNode, node, node.name);
    } else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      registerPattern(node.variableDeclaration.name, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const index: LexicalBindingIndex = { bindingsByScope: mutable, reactStateBindings, recordByNode };
  const attachStateInitializers = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer !== undefined
    ) {
      const initialBoolean = readReactUseStateInitialBoolean(node.initializer, index);
      const first = node.name.elements[0];
      if (
        initialBoolean !== undefined &&
        first !== undefined &&
        ts.isBindingElement(first) &&
        ts.isIdentifier(first.name)
      ) {
        const record = recordByNode.get(first.name);
        if (record !== undefined) record.initialBoolean = initialBoolean;
      }
    }
    ts.forEachChild(node, attachStateInitializers);
  };
  attachStateInitializers(sourceFile);
  return index;
}

/** Adds one exact binding record without collapsing same-spelled declarations. */
function registerLexicalBinding(
  mutable: Map<LexicalScope, Map<string, LexicalBindingRecord[]>>,
  recordByNode: Map<ts.Identifier, LexicalBindingRecord>,
  scope: LexicalScope,
  node: ts.Identifier,
): void {
  const record: LexicalBindingRecord = { node };
  const byName = mutable.get(scope) ?? new Map<string, LexicalBindingRecord[]>();
  const records = byName.get(node.text) ?? [];
  records.push(record);
  byName.set(node.text, records);
  mutable.set(scope, byName);
  recordByNode.set(node, record);
}

/** Resolves one identifier to the nearest unambiguous lexical declaration. */
function resolveLexicalBinding(
  identifier: ts.Identifier,
  index: LexicalBindingIndex,
): LexicalBindingRecord | undefined {
  let current: ts.Node = identifier.parent;
  while (!ts.isSourceFile(current)) {
    if (isLexicalScope(current)) {
      const records = index.bindingsByScope.get(current)?.get(identifier.text);
      if (records !== undefined) return records.length === 1 ? records[0] : undefined;
    }
    current = current.parent;
  }
  const records = index.bindingsByScope.get(current)?.get(identifier.text);
  return records?.length === 1 ? records[0] : undefined;
}

/** Recognizes an exact imported React state hook initialized by a literal boolean. */
function readReactUseStateInitialBoolean(
  expression: ts.Expression,
  index: LexicalBindingIndex,
): boolean | undefined {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isCallExpression(unwrapped)) return undefined;
  const argument = unwrapExpression(unwrapped.arguments[0] ?? unwrapped);
  const initialBoolean = readBooleanLiteral(argument);
  if (initialBoolean === undefined) return undefined;
  const callee = unwrapExpression(unwrapped.expression);
  if (ts.isIdentifier(callee)) {
    const binding = resolveLexicalBinding(callee, index);
    return binding !== undefined && index.reactStateBindings.has(binding.node)
      ? initialBoolean
      : undefined;
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'useState' &&
    ts.isIdentifier(callee.expression)
  ) {
    const binding = resolveLexicalBinding(callee.expression, index);
    return binding !== undefined && index.reactStateBindings.has(binding.node)
      ? initialBoolean
      : undefined;
  }
  return undefined;
}

/** Selects component-shaped workspace imports allowed by exact or provisional fast evidence. */
function collectOverlayImportBindings(
  sourceFile: ts.SourceFile,
  options: PreviewDormantOverlayDeferralOptions,
): readonly OverlayImportBinding[] {
  const bindings: OverlayImportBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.importClause === undefined ||
      statement.importClause.phaseModifier !== undefined ||
      statement.attributes !== undefined
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const resolvedPath = resolveWorkspaceSource(
      specifier,
      options.sourcePath,
      options.workspaceRoot,
      options.resolver,
    );
    if (
      resolvedPath === undefined ||
      (options.resolver.isSideEffectFree?.(resolvedPath) !== true &&
        options.allowProvisionalSideEffectDeferral !== true)
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause.name !== undefined && OVERLAY_NAME_PATTERN.test(clause.name.text)) {
      bindings.push({
        declaration: statement,
        exportName: 'default',
        localName: clause.name.text,
        node: clause.name,
        specifier,
      });
    }
    const named = clause.namedBindings;
    if (named !== undefined && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (
          !element.isTypeOnly &&
          ts.isIdentifier(element.name) &&
          OVERLAY_NAME_PATTERN.test(element.name.text)
        ) {
          bindings.push({
            declaration: statement,
            exportName: (element.propertyName ?? element.name).text,
            localName: element.name.text,
            node: element.name,
            specifier,
          });
        }
      }
    }
  }
  return bindings;
}

/** Resolves one trusted workspace source without admitting installed dependency modules. */
function resolveWorkspaceSource(
  specifier: string,
  importerPath: string,
  workspaceRoot: string,
  resolver: PreviewDormantOverlayResolver,
): string | undefined {
  const resolvedPath = resolver.resolve(specifier, importerPath);
  if (resolvedPath === undefined || resolvedPath.split(path.sep).includes('node_modules')) {
    return undefined;
  }
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(resolvedPath));
  return relative.length === 0 ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    ? resolvedPath
    : undefined;
}

/** Proves every exact imported-binding reference is a dormant JSX tag. */
function isBindingUsedOnlyByDormantJsx(
  binding: OverlayImportBinding,
  sourceFile: ts.SourceFile,
  bindingIndex: LexicalBindingIndex,
): boolean {
  const usage = { invalid: false, jsxCount: 0 };
  const visit = (node: ts.Node): void => {
    if (usage.invalid) return;
    if (ts.isIdentifier(node) && node.text === binding.localName) {
      const resolved = resolveLexicalBinding(node, bindingIndex);
      if (resolved?.node !== binding.node) {
        ts.forEachChild(node, visit);
        return;
      }
      if (node === binding.node) return;
      const opening = readOwningJsxOpening(node);
      if (opening !== undefined && isDormantOverlayOpening(opening, bindingIndex)) {
        usage.jsxCount += 1;
        return;
      }
      if (ts.isJsxClosingElement(node.parent) && node.parent.tagName === node) return;
      usage.invalid = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return !usage.invalid && usage.jsxCount > 0;
}

/** Returns the JSX opening node only when the identifier is the complete tag name. */
function readOwningJsxOpening(
  node: ts.Identifier,
): ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined {
  const parent = node.parent;
  return (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
    parent.tagName === node
    ? parent
    : undefined;
}

/**
 * Accepts only a complete final visibility assignment proven dormant.
 * Spreads are rejected because either their position or an alternate visibility prop can change the
 * effective component contract. Duplicate explicit attributes use JSX's last-write semantics.
 */
function isDormantOverlayOpening(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  bindingIndex: LexicalBindingIndex,
): boolean {
  if (opening.attributes.properties.some((property) => ts.isJsxSpreadAttribute(property))) {
    return false;
  }
  const finalVisibilityAttributes = new Map<string, ts.JsxAttribute>();
  for (const property of opening.attributes.properties) {
    if (!ts.isJsxAttribute(property)) continue;
    const normalizedName = normalizeVisibilityPropName(property.name.getText());
    if (
      POSITIVE_VISIBILITY_PROPS.has(normalizedName) ||
      NEGATIVE_VISIBILITY_PROPS.has(normalizedName)
    ) {
      finalVisibilityAttributes.set(normalizedName, property);
    }
  }
  if (finalVisibilityAttributes.size === 0) return false;
  for (const [propName, property] of finalVisibilityAttributes) {
    const value = readJsxBooleanValue(property, bindingIndex);
    if (value === undefined) return false;
    if (POSITIVE_VISIBILITY_PROPS.has(propName) ? value : !value) return false;
  }
  return true;
}

/** Reads a literal, shorthand, or exact lexical React-state boolean from one JSX attribute. */
function readJsxBooleanValue(
  attribute: ts.JsxAttribute,
  bindingIndex: LexicalBindingIndex,
): boolean | undefined {
  if (attribute.initializer === undefined) return true;
  if (
    !ts.isJsxExpression(attribute.initializer) ||
    attribute.initializer.expression === undefined
  ) {
    return undefined;
  }
  const expression = unwrapExpression(attribute.initializer.expression);
  const literal = readBooleanLiteral(expression);
  if (literal !== undefined) return literal;
  if (!ts.isIdentifier(expression)) return undefined;
  return resolveLexicalBinding(expression, bindingIndex)?.initialBoolean;
}

/** Groups candidate bindings so each import declaration is rewritten exactly once. */
function groupBindingsByDeclaration(
  bindings: readonly OverlayImportBinding[],
): readonly DeferredImportPlan[] {
  const grouped = new Map<ts.ImportDeclaration, OverlayImportBinding[]>();
  for (const binding of bindings) {
    const group = grouped.get(binding.declaration) ?? [];
    group.push(binding);
    grouped.set(binding.declaration, group);
  }
  return [...grouped].map(([declaration, group]) => ({ bindings: group, declaration }));
}

/** Reprints retained bindings and appends line-preserving provisional overlay wrappers. */
function createImportReplacement(
  plan: DeferredImportPlan,
  sourceFile: ts.SourceFile,
  react: DeferredReactBindings,
  allocator: GeneratedBindingAllocator,
  includeReactImport: boolean,
): SourceEdit {
  const deferredNames = new Set(plan.bindings.map((binding) => binding.localName));
  const clause = plan.declaration.importClause;
  if (clause === undefined) throw new TypeError('Dormant overlay plan lost its import clause.');
  const retainedDefault =
    clause.name !== undefined && !deferredNames.has(clause.name.text)
      ? clause.name.getText(sourceFile)
      : undefined;
  const named = clause.namedBindings;
  let retainedBindings: string | undefined;
  if (named !== undefined && ts.isNamespaceImport(named)) {
    retainedBindings = named.getText(sourceFile);
  } else if (named !== undefined && ts.isNamedImports(named)) {
    const elements = named.elements
      .filter((element) => !deferredNames.has(element.name.text))
      .map((element) => element.getText(sourceFile));
    if (elements.length > 0) retainedBindings = `{ ${elements.join(', ')} }`;
  }
  const retainedParts = [retainedDefault, retainedBindings].filter(
    (part): part is string => part !== undefined,
  );
  const retainedImport =
    retainedParts.length === 0
      ? ''
      : `import ${retainedParts.join(', ')} from ${plan.declaration.moduleSpecifier.getText(sourceFile)};`;
  const reactImport = includeReactImport
    ? `import { createElement as ${react.createElement}, forwardRef as ${react.forwardRef} } from "react";`
    : '';
  const wrappers = plan.bindings.map((binding) =>
    createDeferredOverlayWrapper(binding, react, allocator),
  );
  const originalText = sourceFile.text.slice(
    plan.declaration.getStart(sourceFile),
    plan.declaration.end,
  );
  const newlinePadding = '\n'.repeat(countNewlines(originalText));
  return {
    end: plan.declaration.end,
    replacement: `${[reactImport, retainedImport, ...wrappers].filter(Boolean).join(' ')}${newlinePadding}`,
    start: plan.declaration.getStart(sourceFile),
  };
}

/** Creates a ref-preserving fast placeholder without retaining the dormant module graph. */
function createDeferredOverlayWrapper(
  binding: OverlayImportBinding,
  react: DeferredReactBindings,
  allocator: GeneratedBindingAllocator,
): string {
  const properties = allocator.next('__reactPreviewOverlayProps');
  const forwardedRef = allocator.next('__reactPreviewOverlayRef');
  const visible = allocator.next('__reactPreviewOverlayVisible');
  const positiveChecks = [
    'show',
    'open',
    'visible',
    'isOpen',
    'isVisible',
    'active',
    'expanded',
    'present',
    'shown',
    'defaultOpen',
    'defaultVisible',
  ].map((name) => `${properties}?.${name}`);
  const negativeChecks = ['hidden', 'isHidden'].map((name) => `${properties}?.${name} === false`);
  const loadingLabel = `${binding.localName} · deferred during fast preview`;
  return [
    `const ${binding.localName} = ${react.forwardRef}((${properties}, ${forwardedRef}) => {`,
    `const ${visible} = Boolean(${[...positiveChecks, ...negativeChecks].join(' || ')});`,
    `if (!${visible}) return null;`,
    `return ${react.createElement}("div", { "data-react-preview-deferred-overlay": ${JSON.stringify(binding.localName)}, "data-react-preview-module": ${JSON.stringify(binding.specifier)}, ref: ${forwardedRef}, role: "status" }, ${JSON.stringify(loadingLabel)});`,
    '});',
  ].join(' ');
}

/** Applies independent declaration edits without invalidating earlier source offsets. */
function applySourceEdits(sourceText: string, edits: readonly SourceEdit[]): string {
  let transformed = sourceText;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    transformed = transformed.slice(0, edit.start) + edit.replacement + transformed.slice(edit.end);
  }
  return transformed;
}

/** Finds a variable's block/function scope while treating `var` as function-scoped. */
function findVariableScope(declaration: ts.VariableDeclaration): LexicalScope {
  const list = ts.isVariableDeclarationList(declaration.parent) ? declaration.parent : undefined;
  const blockScoped = list !== undefined && (list.flags & ts.NodeFlags.BlockScoped) !== 0;
  let current: ts.Node = declaration.parent;
  while (!ts.isSourceFile(current)) {
    if (blockScoped && isLexicalScope(current) && !isRuntimeFunctionLike(current)) return current;
    if (isRuntimeFunctionLike(current)) return current;
    current = current.parent;
  }
  return current;
}

/** Finds the function that owns one parameter declaration. */
function findNearestFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (isRuntimeFunctionLike(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/** Finds the enclosing scope that owns a function/class declaration binding. */
function findNearestOuterLexicalScope(node: ts.Node): LexicalScope {
  let current = node.parent;
  while (!isLexicalScope(current)) current = current.parent;
  return current;
}

/** Narrows supported lexical scope syntax used by declaration lookup. */
function isLexicalScope(node: ts.Node): node is LexicalScope {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    isRuntimeFunctionLike(node)
  );
}

/** Excludes type-only call/construct signatures from executable lexical function scopes. */
function isRuntimeFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Reads a literal boolean after transparent TypeScript syntax wrappers. */
function readBooleanLiteral(expression: ts.Expression): boolean | undefined {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Removes syntax-only wrappers without evaluating project expressions. */
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

/** Normalizes common camel/snake visibility prop spellings. */
function normalizeVisibilityPropName(value: string): string {
  return value.replaceAll('_', '').toLowerCase();
}

/** Counts physical lines so later authored Inspector locations remain stable. */
function countNewlines(value: string): number {
  return value.match(/\r?\n/gu)?.length ?? 0;
}

/** Selects a JSX-capable TypeScript parser mode from the source extension. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX;
}

/** Fails closed when parser recovery would make identifier ranges ambiguous. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}
