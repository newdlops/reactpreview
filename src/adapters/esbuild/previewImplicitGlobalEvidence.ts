/**
 * Collects explicit, non-executing evidence for application globals supplied outside a component
 * graph. Browser applications sometimes initialize a callable or object in their normal entry file
 * and describe it through an ambient TypeScript declaration. A file-scoped preview does not run
 * that entry, so this analyzer records only import-backed assignments and `typeof import()` types
 * that a later compiler stage can reproduce deliberately.
 *
 * The collector never imports a project module, package, build configuration, or declaration file.
 * Callers provide a bounded source inventory and a resolver callback that owns tsconfig aliases,
 * monorepo rules, symlink policy, and canonical module identity.
 */
import { open } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

/** Hard ceiling aligned with the reusable package inventory consumed by this analyzer. */
export const MAX_IMPLICIT_GLOBAL_EVIDENCE_FILES = 16_384;

/** Hard ceiling for one source read; marker-free large generated files avoid parser allocation. */
export const MAX_IMPLICIT_GLOBAL_EVIDENCE_FILE_BYTES = 16 * 1024 * 1024;

/** Hard aggregate source-text budget for one evidence pass. */
export const MAX_IMPLICIT_GLOBAL_EVIDENCE_TOTAL_BYTES = 128 * 1024 * 1024;

/** Hard ceiling for syntactic candidates resolved during one evidence pass. */
export const MAX_IMPLICIT_GLOBAL_EVIDENCE_CANDIDATES = 512;

/** Keeps simultaneous maximum-size reads within the aggregate evidence memory budget. */
const MAX_CONCURRENT_IMPLICIT_GLOBAL_READS = 8;

const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/iu;
const JAVASCRIPT_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const UNSAFE_GLOBAL_NAMES = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'constructor',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'globalThis',
  'if',
  'implements',
  'import',
  'in',
  'Infinity',
  'instanceof',
  'interface',
  'let',
  'NaN',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'prototype',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'window',
  'with',
  'yield',
]);

/** Supported static origins, ordered from strongest runtime proof to ambient type evidence. */
export type PreviewImplicitGlobalEvidenceKind = 'runtime-assignment' | 'ambient-declaration';

/** Import shapes that a later generated bridge can reproduce without namespace guessing. */
export type PreviewImplicitGlobalExportKind = 'default' | 'named' | 'namespace';

/** One unambiguous workspace-owned mapping from a global identifier to an importable module value. */
export interface PreviewImplicitGlobalEvidence {
  /** Whether executable entry syntax or an erased ambient type established this mapping. */
  readonly evidenceKind: PreviewImplicitGlobalEvidenceKind;
  /** `default`, one named export, or the complete module namespace. */
  readonly exportKind: PreviewImplicitGlobalExportKind;
  /** Exact exported member for `named` evidence. */
  readonly exportName?: string;
  /** JavaScript identifier expected as a free value by application modules. */
  readonly globalName: string;
  /** Canonical module path returned by the caller-owned resolver. */
  readonly modulePath: string;
  /** Authored import specifier retained so aliases and package subpaths keep their semantics. */
  readonly moduleSpecifier: string;
  /** Source file containing the selected assignment or declaration. */
  readonly sourcePath: string;
}

/** Complete result plus enough negative evidence for actionable fallback diagnostics. */
export interface PreviewImplicitGlobalEvidenceInventory {
  /** Same-priority globals with conflicting import identities; none is selected automatically. */
  readonly ambiguousGlobalNames: readonly string[];
  /** Source and resolved module paths whose edits can change the selected evidence. */
  readonly dependencyPaths: readonly string[];
  /** Selected mappings ordered deterministically by global identifier. */
  readonly evidence: readonly PreviewImplicitGlobalEvidence[];
  /** Globals with stronger syntax whose module could not be resolved safely. */
  readonly unresolvedGlobalNames: readonly string[];
  /** Whether a hard source or candidate budget prevented a complete inventory pass. */
  readonly truncated: boolean;
}

/** Resolver contract kept separate from TypeScript so the caller owns all filesystem policy. */
export type PreviewImplicitGlobalModuleResolver = (
  moduleSpecifier: string,
  sourcePath: string,
) => Promise<string | undefined> | string | undefined;

/** Optional snapshot/cache overlay consulted before a bounded filesystem read. */
export type PreviewImplicitGlobalSourceReader = (
  sourcePath: string,
) => Promise<string | undefined> | string | undefined;

/** Bounded source inventory and project-aware resolution hooks for one discovery pass. */
export interface PreviewImplicitGlobalEvidenceOptions {
  /** Optional lower candidate ceiling for tests or latency-sensitive callers. */
  readonly maximumCandidates?: number;
  /** Optional lower per-file byte ceiling. */
  readonly maximumFileBytes?: number;
  /** Optional lower source-file ceiling. */
  readonly maximumFiles?: number;
  /** Optional lower aggregate byte ceiling. */
  readonly maximumTotalBytes?: number;
  /** Resolves an authored specifier from its evidence file to one canonical absolute path. */
  readonly resolveModule: PreviewImplicitGlobalModuleResolver;
  /** Optional snapshot/cache overlay; `undefined` falls back to current filesystem contents. */
  readonly readSource?: PreviewImplicitGlobalSourceReader;
  /** Caller-approved absolute source paths; duplicates and unsupported suffixes are ignored. */
  readonly sourcePaths: readonly string[];
}

/** Import binding information retained before any assignment syntax is inspected. */
interface ImportedBinding {
  readonly exportKind: PreviewImplicitGlobalExportKind;
  readonly exportName?: string;
  readonly moduleSpecifier: string;
}

/** Syntax-only candidate that has not yet crossed caller-owned module resolution. */
interface EvidenceCandidate extends ImportedBinding {
  readonly evidenceKind: PreviewImplicitGlobalEvidenceKind;
  readonly globalName: string;
  readonly sourcePath: string;
}

/** Candidate paired with its canonical resolved identity. */
interface ResolvedEvidenceCandidate extends EvidenceCandidate {
  readonly modulePath: string;
}

/** Bounded source read outcome distinguishing absence from a safety-budget rejection. */
interface BoundedSourceRead {
  readonly sourceText?: string;
  readonly truncated: boolean;
}

/** Selection result for one global name after evidence priority and ambiguity checks. */
interface GlobalEvidenceSelection {
  readonly dependencies: readonly string[];
  readonly evidence?: PreviewImplicitGlobalEvidence;
  readonly state: 'ambiguous' | 'resolved' | 'unresolved';
}

/**
 * Reads and resolves explicit implicit-global evidence without evaluating source or package code.
 *
 * Runtime assignments take precedence over ambient declarations because they represent the value
 * the real application actually installs. Conflicting mappings at the winning priority fail closed.
 * If any hard inventory budget is reached, all evidence is withheld: a skipped entry file could
 * otherwise contain a stronger assignment that changes the selected runtime value.
 *
 * @param options Bounded source paths, optional snapshot reader, and canonical module resolver.
 * @returns Frozen deterministic evidence, dependencies, ambiguity state, and truncation metadata.
 */
export async function collectPreviewImplicitGlobalEvidence(
  options: PreviewImplicitGlobalEvidenceOptions,
): Promise<PreviewImplicitGlobalEvidenceInventory> {
  const limits = readEvidenceLimits(options);
  const sourcePaths = normalizeSourcePaths(options.sourcePaths);
  if (sourcePaths.length > limits.maximumFiles) {
    return createEvidenceInventory({ truncated: true });
  }

  const candidates: EvidenceCandidate[] = [];
  let consumedBytes = 0;
  let truncated = false;

  evidenceScan: for (
    let batchStart = 0;
    batchStart < sourcePaths.length;
    batchStart += MAX_CONCURRENT_IMPLICIT_GLOBAL_READS
  ) {
    const sourceBatchPaths = sourcePaths.slice(
      batchStart,
      batchStart + MAX_CONCURRENT_IMPLICIT_GLOBAL_READS,
    );
    const sourceBatch = await Promise.all(
      sourceBatchPaths.map((sourcePath) =>
        readBoundedSource(sourcePath, limits.maximumFileBytes, options.readSource),
      ),
    );
    for (const [batchIndex, source] of sourceBatch.entries()) {
      if (source.truncated) {
        truncated = true;
        break evidenceScan;
      }
      if (source.sourceText === undefined) {
        continue;
      }
      const sourceBytes = Buffer.byteLength(source.sourceText, 'utf8');
      if (consumedBytes + sourceBytes > limits.maximumTotalBytes) {
        truncated = true;
        break evidenceScan;
      }
      consumedBytes += sourceBytes;
      const sourcePath = sourceBatchPaths[batchIndex];
      if (sourcePath === undefined) {
        continue;
      }
      const sourceCandidates = collectSourceEvidenceCandidates(sourcePath, source.sourceText);
      if (candidates.length + sourceCandidates.length > limits.maximumCandidates) {
        truncated = true;
        break evidenceScan;
      }
      candidates.push(...sourceCandidates);
    }
  }

  if (truncated) {
    return createEvidenceInventory({ truncated: true });
  }
  return resolveAndSelectEvidence(candidates, options.resolveModule);
}

/** Reads hard-capped lower overrides while rejecting zero, fractional, and oversized budgets. */
function readEvidenceLimits(options: PreviewImplicitGlobalEvidenceOptions): {
  readonly maximumCandidates: number;
  readonly maximumFileBytes: number;
  readonly maximumFiles: number;
  readonly maximumTotalBytes: number;
} {
  return {
    maximumCandidates: normalizeLowerLimit(
      options.maximumCandidates,
      MAX_IMPLICIT_GLOBAL_EVIDENCE_CANDIDATES,
    ),
    maximumFileBytes: normalizeLowerLimit(
      options.maximumFileBytes,
      MAX_IMPLICIT_GLOBAL_EVIDENCE_FILE_BYTES,
    ),
    maximumFiles: normalizeLowerLimit(options.maximumFiles, MAX_IMPLICIT_GLOBAL_EVIDENCE_FILES),
    maximumTotalBytes: normalizeLowerLimit(
      options.maximumTotalBytes,
      MAX_IMPLICIT_GLOBAL_EVIDENCE_TOTAL_BYTES,
    ),
  };
}

/** Clamps a caller override to a positive safe integer that can only lower the hard ceiling. */
function normalizeLowerLimit(value: number | undefined, hardLimit: number): number {
  return value === undefined || !Number.isSafeInteger(value) || value <= 0
    ? hardLimit
    : Math.min(value, hardLimit);
}

/** Deduplicates, validates, and sorts caller-owned paths before any filesystem operation. */
function normalizeSourcePaths(sourcePaths: readonly string[]): readonly string[] {
  return [...new Set(sourcePaths)]
    .filter(
      (sourcePath) => path.isAbsolute(sourcePath) && SOURCE_EXTENSION_PATTERN.test(sourcePath),
    )
    .map((sourcePath) => path.normalize(sourcePath))
    .sort();
}

/** Reads a snapshot overlay first, then a size-checked file when the overlay has no current text. */
async function readBoundedSource(
  sourcePath: string,
  maximumBytes: number,
  reader: PreviewImplicitGlobalSourceReader | undefined,
): Promise<BoundedSourceRead> {
  if (reader !== undefined) {
    try {
      const sourceText = await reader(sourcePath);
      if (sourceText !== undefined) {
        return Buffer.byteLength(sourceText, 'utf8') <= maximumBytes
          ? { sourceText, truncated: false }
          : { truncated: true };
      }
    } catch {
      return { truncated: true };
    }
  }

  let fileHandle;
  try {
    fileHandle = await open(sourcePath, 'r');
    const fileStats = await fileHandle.stat();
    if (!fileStats.isFile()) {
      return { truncated: false };
    }
    if (fileStats.size > maximumBytes) {
      return { truncated: true };
    }
    const bufferLength = Math.min(maximumBytes + 1, Math.max(fileStats.size + 1, 1));
    const sourceBuffer = Buffer.alloc(bufferLength);
    let totalBytesRead = 0;
    while (totalBytesRead < sourceBuffer.byteLength) {
      const { bytesRead } = await fileHandle.read(
        sourceBuffer,
        totalBytesRead,
        sourceBuffer.byteLength - totalBytesRead,
        totalBytesRead,
      );
      if (bytesRead === 0) {
        break;
      }
      totalBytesRead += bytesRead;
    }
    if (totalBytesRead > maximumBytes || totalBytesRead > fileStats.size) {
      return { truncated: true };
    }
    return {
      sourceText: sourceBuffer.subarray(0, totalBytesRead).toString('utf8'),
      truncated: false,
    };
  } catch (error) {
    return { truncated: !isMissingPathError(error) };
  } finally {
    await fileHandle?.close();
  }
}

/** Treats a transiently deleted inventory path as absent while failing closed on other I/O errors. */
function isMissingPathError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Parses one file and returns only exact ambient declarations and top-level assignments. */
function collectSourceEvidenceCandidates(
  sourcePath: string,
  sourceText: string,
): readonly EvidenceCandidate[] {
  if (!mayContainImplicitGlobalEvidence(sourceText)) {
    return [];
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return [];
  }

  return [
    ...collectRuntimeAssignmentCandidates(sourceFile, sourcePath),
    ...collectAmbientDeclarationCandidates(sourceFile, sourcePath),
  ];
}

/**
 * Avoids allocating a TypeScript tree for ordinary components with no bootstrap-like syntax.
 * These broad markers are a performance gate only; AST checks below remain authoritative and
 * reject comments, strings, nested assignments, unsafe names, and unsupported type expressions.
 */
function mayContainImplicitGlobalEvidence(sourceText: string): boolean {
  return (
    sourceText.includes('globalThis') ||
    sourceText.includes('window') ||
    (sourceText.includes('declare') &&
      (sourceText.includes('global') || sourceText.includes('var'))) ||
    (sourceText.includes('typeof') && sourceText.includes('import'))
  );
}

/** Builds the top-level import-binding table used by direct global assignments. */
function collectImportedBindings(sourceFile: ts.SourceFile): ReadonlyMap<string, ImportedBinding> {
  const imports = new Map<string, ImportedBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (!isSafeModuleSpecifier(moduleSpecifier)) {
      continue;
    }
    if (clause.name !== undefined) {
      imports.set(clause.name.text, { exportKind: 'default', moduleSpecifier });
    }
    const bindings = clause.namedBindings;
    if (bindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, { exportKind: 'namespace', moduleSpecifier });
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) {
        continue;
      }
      const exportName = (element.propertyName ?? element.name).text;
      imports.set(
        element.name.text,
        exportName === 'default'
          ? { exportKind: 'default', moduleSpecifier }
          : { exportKind: 'named', exportName, moduleSpecifier },
      );
    }
  }
  return imports;
}

/** Matches direct top-level `globalThis/window.name = importedBinding` entry initializers. */
function collectRuntimeAssignmentCandidates(
  sourceFile: ts.SourceFile,
  sourcePath: string,
): readonly EvidenceCandidate[] {
  const imports = collectImportedBindings(sourceFile);
  const candidates: EvidenceCandidate[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) {
      continue;
    }
    const assignment = statement.expression;
    if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
      continue;
    }
    const globalName = readGlobalAssignmentName(assignment.left);
    const importedName = readImportedAssignmentValue(assignment.right);
    const imported = importedName === undefined ? undefined : imports.get(importedName);
    if (globalName === undefined || imported === undefined) {
      continue;
    }
    candidates.push({
      ...imported,
      evidenceKind: 'runtime-assignment',
      globalName,
      sourcePath,
    });
  }
  return candidates;
}

/** Reads an ordinary property assigned directly on `globalThis` or `window`. */
function readGlobalAssignmentName(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(unwrapped)) {
    return undefined;
  }
  const owner = unwrapExpression(unwrapped.expression);
  if (
    !ts.isIdentifier(owner) ||
    (owner.text !== 'globalThis' && owner.text !== 'window') ||
    !isSafeGlobalName(unwrapped.name.text)
  ) {
    return undefined;
  }
  return unwrapped.name.text;
}

/** Accepts an imported identifier alone or with the common empty-object availability fallback. */
function readImportedAssignmentValue(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return unwrapped.text;
  }
  if (
    !ts.isBinaryExpression(unwrapped) ||
    (unwrapped.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
      unwrapped.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) ||
    !isEmptyObjectLiteral(unwrapExpression(unwrapped.right))
  ) {
    return undefined;
  }
  const imported = unwrapExpression(unwrapped.left);
  return ts.isIdentifier(imported) ? imported.text : undefined;
}

/** Reports whether an expression is the inert `{}` fallback used after a real imported value. */
function isEmptyObjectLiteral(expression: ts.Expression): boolean {
  return ts.isObjectLiteralExpression(expression) && expression.properties.length === 0;
}

/** Removes only syntax wrappers that cannot change the runtime identity of an expression. */
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

/** Collects global-augmentation and true script-level ambient `var` declarations. */
function collectAmbientDeclarationCandidates(
  sourceFile: ts.SourceFile,
  sourcePath: string,
): readonly EvidenceCandidate[] {
  const candidates: EvidenceCandidate[] = [];
  if (!ts.isExternalModule(sourceFile)) {
    collectAmbientVariableStatements(sourceFile.statements, sourcePath, candidates, false);
  }
  for (const statement of sourceFile.statements) {
    if (
      ts.isModuleDeclaration(statement) &&
      (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0 &&
      statement.body !== undefined &&
      ts.isModuleBlock(statement.body)
    ) {
      collectAmbientVariableStatements(statement.body.statements, sourcePath, candidates, true);
    }
  }
  return candidates;
}

/** Reads non-block-scoped ambient variables whose type is one exact `typeof import()` member. */
function collectAmbientVariableStatements(
  statements: ts.NodeArray<ts.Statement>,
  sourcePath: string,
  candidates: EvidenceCandidate[],
  insideGlobalAugmentation: boolean,
): void {
  for (const statement of statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0 ||
      !isAmbientVariableStatement(statement, sourcePath, insideGlobalAugmentation)
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !isSafeGlobalName(declaration.name.text) ||
        declaration.initializer !== undefined
      ) {
        continue;
      }
      const imported = readAmbientImportType(declaration.type);
      if (imported === undefined) {
        continue;
      }
      candidates.push({
        ...imported,
        evidenceKind: 'ambient-declaration',
        globalName: declaration.name.text,
        sourcePath,
      });
    }
  }
}

/** Recognizes explicit `declare` or declaration-file script statements as erased ambient syntax. */
function isAmbientVariableStatement(
  statement: ts.VariableStatement,
  sourcePath: string,
  insideGlobalAugmentation: boolean,
): boolean {
  if (insideGlobalAugmentation || sourcePath.toLowerCase().endsWith('.d.ts')) {
    return true;
  }
  return (
    ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) === true
  );
}

/** Decodes `typeof import("module").default` and one exact named member without resolving it. */
function readAmbientImportType(typeNode: ts.TypeNode | undefined): ImportedBinding | undefined {
  if (
    typeNode === undefined ||
    !ts.isImportTypeNode(typeNode) ||
    !typeNode.isTypeOf ||
    typeNode.typeArguments !== undefined ||
    typeNode.qualifier === undefined ||
    !ts.isIdentifier(typeNode.qualifier) ||
    !ts.isLiteralTypeNode(typeNode.argument) ||
    !ts.isStringLiteralLike(typeNode.argument.literal)
  ) {
    return undefined;
  }
  const moduleSpecifier = typeNode.argument.literal.text;
  const exportName = typeNode.qualifier.text;
  if (!isSafeModuleSpecifier(moduleSpecifier) || !JAVASCRIPT_IDENTIFIER_PATTERN.test(exportName)) {
    return undefined;
  }
  return exportName === 'default'
    ? { exportKind: 'default', moduleSpecifier }
    : { exportKind: 'named', exportName, moduleSpecifier };
}

/** Resolves candidates, enforces runtime-over-ambient priority, and rejects uncertain collisions. */
async function resolveAndSelectEvidence(
  candidates: readonly EvidenceCandidate[],
  resolver: PreviewImplicitGlobalModuleResolver,
): Promise<PreviewImplicitGlobalEvidenceInventory> {
  const candidatesByGlobal = new Map<string, EvidenceCandidate[]>();
  for (const candidate of candidates) {
    const entries = candidatesByGlobal.get(candidate.globalName) ?? [];
    entries.push(candidate);
    candidatesByGlobal.set(candidate.globalName, entries);
  }

  const evidence: PreviewImplicitGlobalEvidence[] = [];
  const dependencies = new Set<string>();
  const ambiguousGlobalNames: string[] = [];
  const unresolvedGlobalNames: string[] = [];
  for (const globalName of [...candidatesByGlobal.keys()].sort()) {
    const selection = await selectGlobalEvidence(
      candidatesByGlobal.get(globalName) ?? [],
      resolver,
    );
    if (selection.state === 'ambiguous') {
      ambiguousGlobalNames.push(globalName);
      continue;
    }
    if (selection.state === 'unresolved' || selection.evidence === undefined) {
      unresolvedGlobalNames.push(globalName);
      continue;
    }
    evidence.push(selection.evidence);
    for (const dependencyPath of selection.dependencies) {
      dependencies.add(dependencyPath);
    }
  }
  return createEvidenceInventory({
    ambiguousGlobalNames,
    dependencyPaths: [...dependencies].sort(),
    evidence,
    unresolvedGlobalNames,
    truncated: false,
  });
}

/** Selects one mapping at the strongest syntax priority and fails closed on any uncertainty. */
async function selectGlobalEvidence(
  candidates: readonly EvidenceCandidate[],
  resolver: PreviewImplicitGlobalModuleResolver,
): Promise<GlobalEvidenceSelection> {
  const runtimeCandidates = candidates.filter(
    (candidate) => candidate.evidenceKind === 'runtime-assignment',
  );
  const winningCandidates = runtimeCandidates.length > 0 ? runtimeCandidates : candidates;
  const resolvedCandidates: ResolvedEvidenceCandidate[] = [];
  let hasUnresolvedCandidate = false;
  for (const candidate of winningCandidates) {
    const modulePath = await resolveCandidateModule(candidate, resolver);
    if (modulePath === undefined) {
      hasUnresolvedCandidate = true;
      continue;
    }
    resolvedCandidates.push({ ...candidate, modulePath });
  }
  if (hasUnresolvedCandidate || resolvedCandidates.length === 0) {
    return { dependencies: [], state: 'unresolved' };
  }

  const identities = new Set(resolvedCandidates.map(createCandidateIdentity));
  if (identities.size !== 1) {
    return { dependencies: [], state: 'ambiguous' };
  }
  resolvedCandidates.sort(compareResolvedCandidates);
  const selected = resolvedCandidates[0];
  if (selected === undefined) {
    return { dependencies: [], state: 'unresolved' };
  }
  const dependencies = new Set<string>();
  for (const candidate of resolvedCandidates) {
    dependencies.add(candidate.sourcePath);
    dependencies.add(candidate.modulePath);
  }
  return {
    dependencies: [...dependencies].sort(),
    evidence: freezePublicEvidence(selected),
    state: 'resolved',
  };
}

/** Calls the project resolver defensively and accepts only canonical-looking absolute file paths. */
async function resolveCandidateModule(
  candidate: EvidenceCandidate,
  resolver: PreviewImplicitGlobalModuleResolver,
): Promise<string | undefined> {
  try {
    const modulePath = await resolver(candidate.moduleSpecifier, candidate.sourcePath);
    return modulePath !== undefined && path.isAbsolute(modulePath)
      ? path.normalize(modulePath)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Creates a collision identity independent of authored alias spelling and evidence file location. */
function createCandidateIdentity(candidate: ResolvedEvidenceCandidate): string {
  return [candidate.modulePath, candidate.exportKind, candidate.exportName ?? ''].join('\0');
}

/** Orders equivalent evidence reproducibly while preferring no incidental filesystem traversal. */
function compareResolvedCandidates(
  left: ResolvedEvidenceCandidate,
  right: ResolvedEvidenceCandidate,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.moduleSpecifier.localeCompare(right.moduleSpecifier)
  );
}

/** Copies one internal candidate into an immutable public value with exact optional properties. */
function freezePublicEvidence(candidate: ResolvedEvidenceCandidate): PreviewImplicitGlobalEvidence {
  return Object.freeze({
    evidenceKind: candidate.evidenceKind,
    exportKind: candidate.exportKind,
    ...(candidate.exportName === undefined ? {} : { exportName: candidate.exportName }),
    globalName: candidate.globalName,
    modulePath: candidate.modulePath,
    moduleSpecifier: candidate.moduleSpecifier,
    sourcePath: candidate.sourcePath,
  });
}

/** Creates a deeply immutable inventory while supplying stable defaults for early exits. */
function createEvidenceInventory(
  values: Partial<PreviewImplicitGlobalEvidenceInventory>,
): PreviewImplicitGlobalEvidenceInventory {
  return Object.freeze({
    ambiguousGlobalNames: Object.freeze([...(values.ambiguousGlobalNames ?? [])]),
    dependencyPaths: Object.freeze([...(values.dependencyPaths ?? [])]),
    evidence: Object.freeze([...(values.evidence ?? [])]),
    unresolvedGlobalNames: Object.freeze([...(values.unresolvedGlobalNames ?? [])]),
    truncated: values.truncated ?? false,
  });
}

/** Rejects empty, NUL-containing, and query/hash-bearing specifiers from generated import evidence. */
function isSafeModuleSpecifier(moduleSpecifier: string): boolean {
  return (
    moduleSpecifier.length > 0 &&
    moduleSpecifier.length <= 1_024 &&
    !/[\0?#]/u.test(moduleSpecifier)
  );
}

/** Applies identifier, keyword, and prototype-sensitive safety checks to one global name. */
function isSafeGlobalName(globalName: string): boolean {
  return JAVASCRIPT_IDENTIFIER_PATTERN.test(globalName) && !UNSAFE_GLOBAL_NAMES.has(globalName);
}

/** Reads parser diagnostics through TypeScript's intentionally non-public source-file field. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  return (
    ((
      sourceFile as ts.SourceFile & {
        readonly parseDiagnostics?: readonly ts.Diagnostic[];
      }
    ).parseDiagnostics?.length ?? 0) > 0
  );
}

/** Chooses TSX-aware grammar from the supplied source filename without consulting configuration. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const lowercasePath = sourcePath.toLowerCase();
  if (lowercasePath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (
    lowercasePath.endsWith('.ts') ||
    lowercasePath.endsWith('.mts') ||
    lowercasePath.endsWith('.cts')
  ) {
    return ts.ScriptKind.TS;
  }
  return lowercasePath.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
}
