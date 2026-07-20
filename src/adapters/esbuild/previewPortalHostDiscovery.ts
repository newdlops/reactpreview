/**
 * Discovers inert DOM hosts required by React portals in the selected render corridor.
 * An exact ReactDOM portal call first proves the graph capability; direct lookups and correlated
 * reached host declarations can then contribute IDs without executing application modules.
 */
import path from 'node:path';
import ts from 'typescript';

const MAX_PORTAL_HOST_SOURCE_BYTES = 256 * 1024;
const MAX_PORTAL_SEED_SOURCE_FILES = 192;
const MAX_PORTAL_CORRELATED_SOURCE_FILES = 96;
const MAX_PORTAL_FRONTIER_SOURCE_FILES = 64;
const MAX_PORTAL_HINTED_SOURCE_FILES = 128;
const MAX_PORTAL_HOST_IDS = 64;
const SOURCE_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/iu;
const PORTAL_PATH_HINT_PATTERN =
  /(?:dialog|document|drawer|modal|overlay|pop-?up|portal|sheet|toast)/iu;
const PORTAL_HOST_DECLARATION_PATH_PATTERN =
  /(?:portal[^/\\]*(?:host|root)|(?:host|root)[^/\\]*portal)/iu;
const PORTAL_HOST_LEXICAL_PATTERN =
  /\b(?:dialog|drawer|modal|overlay|portal|sheet|toast)(?:Host|Hosts|Id|Ids|Root|Roots|Group|Order)\b|\b(?:HOST|HOSTS|ID|IDS|ROOT|ROOTS)_?(?:DIALOG|DRAWER|MODAL|OVERLAY|PORTAL|SHEET|TOAST)\b/iu;

/** Byte-bounded source reader backed by the compiler-lifetime project analysis cache. */
export type ReadPreviewPortalHostSource = (
  sourcePath: string,
  maximumBytes: number,
) => Promise<string | undefined>;

/** Inputs limiting portal-host discovery to the statically reached project graph. */
export interface DiscoverPreviewPortalHostIdsOptions {
  /** Target and dependency files proven reachable for the selected preview candidate. */
  readonly dependencyPaths: readonly string[];
  /** Current-source reader; dirty editor snapshots should take precedence over disk. */
  readonly readSource: ReadPreviewPortalHostSource;
}

/** ReactDOM bindings that prove `createPortal` means the browser React portal API. */
interface ReactDomPortalBindings {
  readonly direct: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
}

/** Static string tables used to resolve enum members and local host arrays without evaluation. */
interface PreviewPortalStaticValues {
  readonly arrays: ReadonlyMap<string, readonly string[]>;
  readonly enumMembers: ReadonlyMap<string, string>;
}

/** Map-callback variables whose values were resolved from an exact local string array. */
type PreviewPortalMapBindings = ReadonlyMap<string, readonly string[]>;

/** Parsed reached module retained only when it can seed or satisfy portal-host correlation. */
interface PreviewPortalSourceAnalysis {
  /** True only for a call bound to the browser `react-dom` package. */
  readonly containsPortalCall: boolean;
  /** Exact static import/re-export specifiers used to locate a second-stage host module. */
  readonly moduleSpecifiers: readonly string[];
  /** Normalized reached source identity. */
  readonly sourcePath: string;
  /** Parsed syntax tree reused by lookup and authored-host collectors. */
  readonly sourceFile: ts.SourceFile;
  /** Cheap lexical proof that this module intentionally names portal host infrastructure. */
  readonly containsHostLexicalEvidence: boolean;
}

/** Pre-indexed reached source identities used by second-stage literal import correlation. */
interface PreviewPortalModulePathIndex {
  readonly byBasename: ReadonlyMap<string, readonly string[]>;
  readonly byExtensionlessIdentity: ReadonlyMap<string, readonly string[]>;
}

/**
 * Reads a bounded, prioritized subset of the selected graph and returns unique portal host IDs.
 * Filename hints affect first-stage scan order only. Accepted host declarations must share the
 * proven portal module, carry explicit host lexemes, or be reached through one exact static import;
 * ordinary element lookup modules therefore retain their authored missing-element behavior.
 *
 * @param options Reached source identities and the shared byte-bounded source reader.
 * @returns Stable host IDs that may be safely created before target modules evaluate.
 */
export async function discoverPreviewPortalHostIds(
  options: DiscoverPreviewPortalHostIdsOptions,
): Promise<readonly string[]> {
  const sourcePaths = collectPreviewPortalSourcePaths(options.dependencyPaths);
  const seedPaths = selectPreviewPortalSeedPaths(sourcePaths);
  const seedAnalyses = await readPreviewPortalSourceAnalyses(seedPaths, options.readSource);
  const portalAnalyses = seedAnalyses.filter((analysis) => analysis.containsPortalCall);
  if (portalAnalyses.length === 0) return [];

  const lexicalSeedAnalyses = seedAnalyses.filter(
    (analysis) =>
      analysis.containsPortalCall ||
      analysis.containsHostLexicalEvidence ||
      PORTAL_PATH_HINT_PATTERN.test(analysis.sourcePath),
  );
  const correlatedPaths = collectPreviewPortalCorrelatedPaths(
    sourcePaths,
    seedPaths,
    lexicalSeedAnalyses,
  );
  const correlatedAnalyses = await readPreviewPortalSourceAnalyses(
    correlatedPaths,
    options.readSource,
  );
  const correlatedPathSet = new Set(correlatedPaths);
  const analyses = deduplicatePreviewPortalAnalyses([...seedAnalyses, ...correlatedAnalyses]);
  const sharedEnumMembers = collectPreviewPortalGraphEnumMembers(analyses);
  const hostIds = new Set<string>();
  for (const analysis of analyses) {
    if (analysis.containsPortalCall) collectDirectPortalLookupIds(analysis.sourceFile, hostIds);
    if (
      !analysis.containsPortalCall &&
      !analysis.containsHostLexicalEvidence &&
      !correlatedPathSet.has(analysis.sourcePath)
    ) {
      continue;
    }
    const staticValues = collectPreviewPortalStaticValues(analysis.sourceFile, sharedEnumMembers);
    collectAuthoredPortalHostIds(analysis.sourceFile, staticValues, hostIds, new Map());
    if (hostIds.size >= MAX_PORTAL_HOST_IDS) break;
  }
  return freezePreviewPortalHostIds(hostIds);
}

/**
 * Collects exact host IDs from one portal implementation without executing project code.
 * Direct literal lookups are supported together with the common authored host-group form where an
 * enum-backed array is mapped into `<div id={id}>` elements beside a reusable portal component.
 *
 * @param sourcePath Source identity used to select TypeScript or TSX grammar.
 * @param sourceText Current source bytes for one reached module.
 * @returns Unique, bounded DOM IDs proven by this module.
 */
export function collectPreviewPortalHostIds(
  sourcePath: string,
  sourceText: string,
): readonly string[] {
  if (!SOURCE_EXTENSION_PATTERN.test(sourcePath) || !sourceText.includes('createPortal')) {
    return [];
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectPreviewPortalScriptKind(sourcePath),
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0) return [];
  const portalBindings = collectReactDomPortalBindings(sourceFile);
  if (!containsReactDomCreatePortalCall(sourceFile, portalBindings)) return [];

  const staticValues = collectPreviewPortalStaticValues(sourceFile, new Map());
  const hostIds = new Set<string>();
  collectDirectPortalLookupIds(sourceFile, hostIds);
  collectAuthoredPortalHostIds(sourceFile, staticValues, hostIds, new Map());
  return freezePreviewPortalHostIds(hostIds);
}

/** Normalizes reached JS-like identities once while preserving target-first graph order. */
function collectPreviewPortalSourcePaths(dependencyPaths: readonly string[]): readonly string[] {
  return [
    ...new Set(
      dependencyPaths
        .filter((sourcePath) => SOURCE_EXTENSION_PATTERN.test(sourcePath))
        .map((sourcePath) => path.normalize(sourcePath)),
    ),
  ];
}

/**
 * Selects a small first-stage scan from the target frontier and portal-like filenames.
 * The former catches locally named wrappers; the latter catches shared modal/host infrastructure
 * without reading hundreds of unrelated reached modules.
 */
function selectPreviewPortalSeedPaths(sourcePaths: readonly string[]): readonly string[] {
  const frontierPaths = sourcePaths.slice(0, MAX_PORTAL_FRONTIER_SOURCE_FILES);
  const hintedPaths = sourcePaths
    .filter((sourcePath) => PORTAL_PATH_HINT_PATTERN.test(sourcePath))
    .sort()
    .slice(0, MAX_PORTAL_HINTED_SOURCE_FILES);
  return [...new Set([...frontierPaths, ...hintedPaths])].slice(0, MAX_PORTAL_SEED_SOURCE_FILES);
}

/** Reads and parses one bounded path set in small batches to avoid a large concurrent I/O burst. */
async function readPreviewPortalSourceAnalyses(
  sourcePaths: readonly string[],
  readSource: ReadPreviewPortalHostSource,
): Promise<readonly PreviewPortalSourceAnalysis[]> {
  const analyses: PreviewPortalSourceAnalysis[] = [];
  for (let offset = 0; offset < sourcePaths.length; offset += 24) {
    const batch = sourcePaths.slice(offset, offset + 24);
    const sources = await Promise.all(
      batch.map(async (sourcePath) => ({
        sourcePath,
        sourceText: await readSource(sourcePath, MAX_PORTAL_HOST_SOURCE_BYTES),
      })),
    );
    for (const { sourcePath, sourceText } of sources) {
      if (sourceText === undefined) continue;
      const analysis = analyzePreviewPortalSource(sourcePath, sourceText);
      if (analysis !== undefined) analyses.push(analysis);
    }
  }
  return analyses;
}

/** Parses one current reached module and retains exact portal/import/host lexical facts. */
function analyzePreviewPortalSource(
  sourcePath: string,
  sourceText: string,
): PreviewPortalSourceAnalysis | undefined {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectPreviewPortalScriptKind(sourcePath),
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0) return undefined;
  const portalBindings = collectReactDomPortalBindings(sourceFile);
  return {
    containsHostLexicalEvidence:
      PORTAL_HOST_LEXICAL_PATTERN.test(sourceText) ||
      PORTAL_HOST_DECLARATION_PATH_PATTERN.test(sourcePath),
    containsPortalCall:
      sourceText.includes('createPortal') &&
      containsReactDomCreatePortalCall(sourceFile, portalBindings),
    moduleSpecifiers: collectPreviewPortalModuleSpecifiers(sourceFile),
    sourceFile,
    sourcePath,
  };
}

/** Collects only literal ESM import/re-export edges; dynamic expressions never seed filesystem I/O. */
function collectPreviewPortalModuleSpecifiers(sourceFile: ts.SourceFile): readonly string[] {
  const moduleSpecifiers = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      moduleSpecifiers.add(statement.moduleSpecifier.text);
    }
  }
  return [...moduleSpecifiers];
}

/**
 * Resolves second-stage source identities from literal module specifiers against the reached graph.
 * Relative imports require an exact extensionless/index match. Alias-like specifiers are accepted
 * only when their normalized suffix identifies exactly one reached source.
 */
function collectPreviewPortalCorrelatedPaths(
  sourcePaths: readonly string[],
  seedPaths: readonly string[],
  analyses: readonly PreviewPortalSourceAnalysis[],
): readonly string[] {
  const seedPathSet = new Set(seedPaths);
  const correlatedPaths = new Set<string>();
  const pathIndex = createPreviewPortalModulePathIndex(sourcePaths);
  for (const analysis of analyses) {
    for (const moduleSpecifier of analysis.moduleSpecifiers) {
      const matches = resolvePreviewPortalModuleSpecifierPaths(
        pathIndex,
        analysis.sourcePath,
        moduleSpecifier,
      );
      if (matches.length !== 1) continue;
      const matchedPath = matches[0];
      if (matchedPath !== undefined && !seedPathSet.has(matchedPath)) {
        correlatedPaths.add(matchedPath);
      }
      if (correlatedPaths.size >= MAX_PORTAL_CORRELATED_SOURCE_FILES) {
        return [...correlatedPaths];
      }
    }
  }
  return [...correlatedPaths];
}

/** Builds exact and basename indices once instead of rescanning a large graph per import edge. */
function createPreviewPortalModulePathIndex(
  sourcePaths: readonly string[],
): PreviewPortalModulePathIndex {
  const byBasename = new Map<string, Set<string>>();
  const byExtensionlessIdentity = new Map<string, Set<string>>();
  for (const sourcePath of sourcePaths) {
    for (const identity of collectPreviewPortalExtensionlessIdentities(sourcePath)) {
      const identityPaths = byExtensionlessIdentity.get(identity) ?? new Set<string>();
      identityPaths.add(sourcePath);
      byExtensionlessIdentity.set(identity, identityPaths);
      const basename = path.basename(identity);
      const basenamePaths = byBasename.get(basename) ?? new Set<string>();
      basenamePaths.add(sourcePath);
      byBasename.set(basename, basenamePaths);
    }
  }
  return {
    byBasename: new Map(
      [...byBasename].map(([basename, paths]) => [basename, [...paths]] as const),
    ),
    byExtensionlessIdentity: new Map(
      [...byExtensionlessIdentity].map(([identity, paths]) => [identity, [...paths]] as const),
    ),
  };
}

/** Resolves one authored module edge without consulting Node resolution or executing package code. */
function resolvePreviewPortalModuleSpecifierPaths(
  index: PreviewPortalModulePathIndex,
  importerPath: string,
  moduleSpecifier: string,
): readonly string[] {
  if (moduleSpecifier.length === 0 || moduleSpecifier.includes('\0')) return [];
  const extensionlessSpecifier = moduleSpecifier.replace(SOURCE_EXTENSION_PATTERN, '');
  if (moduleSpecifier.startsWith('.')) {
    const absoluteSpecifier = path.normalize(
      path.resolve(path.dirname(importerPath), extensionlessSpecifier),
    );
    return index.byExtensionlessIdentity.get(absoluteSpecifier) ?? [];
  }
  if (path.isAbsolute(moduleSpecifier)) {
    return index.byExtensionlessIdentity.get(path.normalize(extensionlessSpecifier)) ?? [];
  }

  const normalizedSpecifier = extensionlessSpecifier.replaceAll('\\', '/').replace(/^~?@\//u, '');
  if (normalizedSpecifier.length === 0) return [];
  const basename = path.posix.basename(normalizedSpecifier);
  const basenameCandidates = index.byBasename.get(basename) ?? [];
  return basenameCandidates.filter((candidatePath) =>
    collectPreviewPortalExtensionlessIdentities(candidatePath).some((identity) => {
      const normalizedIdentity = identity.split(path.sep).join('/');
      return (
        normalizedIdentity === normalizedSpecifier ||
        normalizedIdentity.endsWith(`/${normalizedSpecifier}`)
      );
    }),
  );
}

/** Returns file and conventional index-module identities with JS-like extensions removed. */
function collectPreviewPortalExtensionlessIdentities(sourcePath: string): readonly string[] {
  const extensionlessPath = sourcePath.replace(SOURCE_EXTENSION_PATTERN, '');
  return path.basename(extensionlessPath).toLowerCase() === 'index'
    ? [extensionlessPath, path.dirname(extensionlessPath)]
    : [extensionlessPath];
}

/** Keeps one parsed instance for each normalized path while preserving first-stage ordering. */
function deduplicatePreviewPortalAnalyses(
  analyses: readonly PreviewPortalSourceAnalysis[],
): readonly PreviewPortalSourceAnalysis[] {
  const byPath = new Map<string, PreviewPortalSourceAnalysis>();
  for (const analysis of analyses) {
    if (!byPath.has(analysis.sourcePath)) byPath.set(analysis.sourcePath, analysis);
  }
  return [...byPath.values()];
}

/** Merges graph enum literals so a host module can map an enum declared beside its portal API. */
function collectPreviewPortalGraphEnumMembers(
  analyses: readonly PreviewPortalSourceAnalysis[],
): ReadonlyMap<string, string> {
  const valuesByMember = new Map<string, Set<string>>();
  for (const analysis of analyses) {
    for (const [memberName, memberValue] of collectPreviewPortalEnumMembers(analysis.sourceFile)) {
      const values = valuesByMember.get(memberName) ?? new Set<string>();
      values.add(memberValue);
      valuesByMember.set(memberName, values);
    }
  }
  const unambiguousMembers = new Map<string, string>();
  for (const [memberName, values] of valuesByMember) {
    if (values.size !== 1) continue;
    const memberValue = values.values().next().value;
    if (memberValue !== undefined) unambiguousMembers.set(memberName, memberValue);
  }
  return unambiguousMembers;
}

/** Selects parser grammar from the reached source extension. */
function selectPreviewPortalScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Finds exact named, namespace, and default bindings imported from browser `react-dom`. */
function collectReactDomPortalBindings(sourceFile: ts.SourceFile): ReactDomPortalBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react-dom'
    ) {
      continue;
    }
    const importClause = statement.importClause;
    if (importClause?.name !== undefined) namespaces.add(importClause.name.text);
    const namedBindings = importClause?.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      namespaces.add(namedBindings.name.text);
      continue;
    }
    for (const element of namedBindings.elements) {
      if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'createPortal') {
        direct.add(element.name.text);
      }
    }
  }
  return { direct, namespaces };
}

/** Proves that at least one call resolves to the imported ReactDOM `createPortal` API. */
function containsReactDomCreatePortalCall(
  sourceFile: ts.SourceFile,
  bindings: ReactDomPortalBindings,
): boolean {
  let found = false;
  /** Visits only until an exact portal call has been found. */
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isCallExpression(node) && isReactDomCreatePortalExpression(node.expression, bindings)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/** Checks direct and namespace/default imported ReactDOM portal callees. */
function isReactDomCreatePortalExpression(
  expression: ts.Expression,
  bindings: ReactDomPortalBindings,
): boolean {
  if (ts.isIdentifier(expression)) return bindings.direct.has(expression.text);
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'createPortal' &&
    ts.isIdentifier(expression.expression) &&
    bindings.namespaces.has(expression.expression.text)
  );
}

/** Reads exact literal ID requirements from browser-global element lookup APIs. */
function collectDirectPortalLookupIds(sourceFile: ts.SourceFile, hostIds: Set<string>): void {
  /** Visits all syntax because a lookup may live inside a nested portal callback. */
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isDocumentGetElementByIdCall(node)) {
      const hostId = readStaticString(node.arguments[0]);
      if (hostId !== undefined) hostIds.add(hostId);
    }
    if (ts.isCallExpression(node) && isDocumentQuerySelectorCall(node)) {
      const selector = readStaticString(node.arguments[0]);
      const hostId = selector === undefined ? undefined : readSafeExactIdSelector(selector);
      if (hostId !== undefined) hostIds.add(hostId);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

/** Recognizes only the browser-global `document.getElementById` property call. */
function isDocumentGetElementByIdCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'getElementById' &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'document'
  );
}

/** Recognizes only the browser-global `document.querySelector` property call. */
function isDocumentQuerySelectorCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'querySelector' &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'document'
  );
}

/** Accepts one unescaped identifier selector and rejects combinators, classes, and attributes. */
function readSafeExactIdSelector(selector: string): string | undefined {
  const match = /^#([A-Za-z_][A-Za-z\d_-]{0,255})$/u.exec(selector);
  return match?.[1];
}

/** Reads exact string-valued enum members without resolving computed initializers. */
function collectPreviewPortalEnumMembers(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const enumMembers = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isEnumDeclaration(statement)) continue;
    for (const member of statement.members) {
      const memberName = readStaticPropertyName(member.name);
      const memberValue = readStaticString(member.initializer);
      if (memberName !== undefined && memberValue !== undefined) {
        enumMembers.set(`${statement.name.text}.${memberName}`, memberValue);
      }
    }
  }
  return enumMembers;
}

/** Builds immutable enum and const-array values used by authored portal host groups. */
function collectPreviewPortalStaticValues(
  sourceFile: ts.SourceFile,
  graphEnumMembers: ReadonlyMap<string, string>,
): PreviewPortalStaticValues {
  const enumMembers = new Map(graphEnumMembers);
  for (const [memberName, memberValue] of collectPreviewPortalEnumMembers(sourceFile)) {
    enumMembers.set(memberName, memberValue);
  }

  const arrays = new Map<string, readonly string[]>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        initializer === undefined ||
        !ts.isIdentifier(declaration.name) ||
        !ts.isArrayLiteralExpression(initializer)
      ) {
        continue;
      }
      const values = initializer.elements.flatMap((element) =>
        resolvePreviewPortalStaticExpression(element, { arrays, enumMembers }, new Map()),
      );
      if (values.length > 0) arrays.set(declaration.name.text, Object.freeze(values));
    }
  }
  return { arrays, enumMembers };
}

/** Resolves static JSX ID attributes, including array-map callback parameters. */
function collectAuthoredPortalHostIds(
  node: ts.Node,
  staticValues: PreviewPortalStaticValues,
  hostIds: Set<string>,
  mapBindings: PreviewPortalMapBindings,
): void {
  if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'id') {
    const initializer = node.initializer;
    if (initializer !== undefined && ts.isStringLiteral(initializer)) {
      hostIds.add(initializer.text);
    }
    if (
      initializer !== undefined &&
      ts.isJsxExpression(initializer) &&
      initializer.expression !== undefined
    ) {
      for (const value of resolvePreviewPortalStaticExpression(
        initializer.expression,
        staticValues,
        mapBindings,
      )) {
        hostIds.add(value);
      }
    }
  }
  if (ts.isCallExpression(node)) {
    const mapContext = readPreviewPortalMapContext(node, staticValues, mapBindings);
    if (mapContext !== undefined) {
      collectAuthoredPortalHostIds(
        mapContext.body,
        staticValues,
        hostIds,
        new Map([...mapBindings, [mapContext.parameterName, mapContext.values]]),
      );
      collectAuthoredPortalHostIds(node.expression, staticValues, hostIds, mapBindings);
      return;
    }
  }
  ts.forEachChild(node, (child) => {
    collectAuthoredPortalHostIds(child, staticValues, hostIds, mapBindings);
  });
}

/** Resolved callback body and values for one exact local `array.map(id => ...)` expression. */
interface PreviewPortalMapContext {
  readonly body: ts.ConciseBody;
  readonly parameterName: string;
  readonly values: readonly string[];
}

/** Resolves a local static array into the first identifier parameter of its map callback. */
function readPreviewPortalMapContext(
  node: ts.CallExpression,
  staticValues: PreviewPortalStaticValues,
  mapBindings: PreviewPortalMapBindings,
): PreviewPortalMapContext | undefined {
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== 'map' ||
    node.arguments.length === 0
  ) {
    return undefined;
  }
  const callback = node.arguments[0];
  const firstParameterName =
    callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ? callback.parameters[0]?.name
      : undefined;
  if (
    callback === undefined ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    firstParameterName === undefined ||
    !ts.isIdentifier(firstParameterName)
  ) {
    return undefined;
  }
  const values = resolvePreviewPortalStaticExpression(
    node.expression.expression,
    staticValues,
    mapBindings,
  );
  return values.length === 0
    ? undefined
    : { body: callback.body, parameterName: firstParameterName.text, values };
}

/** Resolves the small expression subset allowed for inert portal host IDs. */
function resolvePreviewPortalStaticExpression(
  expression: ts.Expression,
  staticValues: PreviewPortalStaticValues,
  mapBindings: PreviewPortalMapBindings,
): readonly string[] {
  const literal = readStaticString(expression);
  if (literal !== undefined) return [literal];
  if (ts.isIdentifier(expression)) {
    return mapBindings.get(expression.text) ?? staticValues.arrays.get(expression.text) ?? [];
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const value = staticValues.enumMembers.get(
      `${expression.expression.text}.${expression.name.text}`,
    );
    return value === undefined ? [] : [value];
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) =>
      resolvePreviewPortalStaticExpression(element, staticValues, mapBindings),
    );
  }
  return [];
}

/** Reads exact string and no-substitution template literals without evaluating expressions. */
function readStaticString(node: ts.Node | undefined): string | undefined {
  return node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

/** Reads enum member keys that have stable source-level identities. */
function readStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** Rejects empty, control-character, whitespace, or unreasonably large synthesized DOM IDs. */
function isSafePreviewPortalHostId(hostId: string): boolean {
  return hostId.length > 0 && hostId.length <= 256 && !/[\u0000-\u0020\u007f]/u.test(hostId);
}

/** Filters, de-duplicates, sorts, and bounds DOM IDs at the final trust boundary. */
function freezePreviewPortalHostIds(hostIds: ReadonlySet<string>): readonly string[] {
  return Object.freeze(
    [...hostIds].filter(isSafePreviewPortalHostId).sort().slice(0, MAX_PORTAL_HOST_IDS),
  );
}
