/**
 * Extracts a bounded, syntax-only JSX render slice around an imported React component usage.
 * The analyzer retains only the target and its directly reproducible ancestor wrapper branch; it
 * never executes the consumer module or pulls sibling JSX into the eventual preview bundle.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  collectPreviewParentSliceImportBindings,
  matchesPreviewParentSliceTargetImport,
  type PreviewParentSliceImportBinding,
} from './previewParentSliceImports';
import {
  hasUnsafePreviewParentSliceRuntimeAttributes,
  readPreviewParentSliceStaticProps,
} from './previewParentSliceStaticProps';
import type {
  PreviewParentSliceChildMode,
  PreviewParentSliceFrame,
  PreviewParentSliceStaticProps,
} from './previewParentSliceSource';

const MAX_CONSUMER_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_TARGET_EXPORTS = 128;
const MAX_TARGET_USAGES = 64;
const MAX_ANCESTOR_FRAMES = 32;
const MAX_JSX_MEMBER_DEPTH = 8;

/** Syntactic owner used by a later reverse-graph pass to continue climbing through exported JSX. */
export interface PreviewParentSliceOwner {
  /** Runtime exports referring to this owner in stable source order. */
  readonly exportNames: readonly string[];
  /** Local declaration name, or `null` for an anonymous default-exported function. */
  readonly localName: string | null;
}

/** Pinpoint render plan for one exact JSX occurrence of one selected target export. */
export interface PreviewParentSlice {
  readonly consumerPath: string;
  /** Whether every encountered JSX wrapper was safely classifiable before the owner boundary. */
  readonly complete: boolean;
  /** Wrapper order is inner-to-outer so a generator can fold over it without loading siblings. */
  readonly frames: readonly PreviewParentSliceFrame[];
  readonly occurrenceStart: number;
  readonly owner: PreviewParentSliceOwner | null;
  readonly targetExportName: string;
  readonly targetLocalName: string;
  readonly targetProps: PreviewParentSliceStaticProps;
}

/** Config-aware fallback proving that one authored import resolves to the selected target module. */
export type MatchesPreviewParentSliceTargetImport = (
  moduleSpecifier: string,
  consumerPath: string,
  targetPath: string,
) => boolean;

/** Inputs for one in-memory consumer analysis; no filesystem or module execution is performed. */
export interface AnalyzePreviewParentSlicesOptions {
  /** Additional exact alias specifiers already accepted by project-aware module resolution. */
  readonly acceptedTargetImportSpecifiers?: readonly string[];
  readonly consumerPath: string;
  /** Optional config-aware identity check used after conservative lexical matching fails. */
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  readonly sourceText: string;
  /** Runtime export names selected from the target module, including the string `default`. */
  readonly targetExportNames: readonly string[];
  readonly targetPath: string;
}

/** Inputs for continuing a reverse climb through a component declared in the same source file. */
export interface AnalyzePreviewLocalParentSlicesOptions {
  readonly consumerPath: string;
  /** Top-level source-local component name obtained from a preceding slice's `owner` field. */
  readonly localComponentName: string;
  readonly sourceText: string;
}

/** Parse/limit metadata accompanying all pinpoint slices found in one consumer source. */
export interface PreviewParentSliceAnalysis {
  /** Signals that a fixed export, occurrence, or frame ceiling omitted additional syntax. */
  readonly limitReached: boolean;
  readonly slices: readonly PreviewParentSlice[];
  readonly status: 'ok' | 'parse-error' | 'source-too-large';
}

/** JSX tag root and optional property chain resolved without evaluating the imported value. */
interface JsxTagReference {
  readonly memberPath: readonly string[];
  readonly rootName: string;
  readonly tagName: string;
}

/** Selected target runtime export associated with one direct local import binding. */
interface TargetImportReference {
  readonly allowedNamespaceExports: ReadonlySet<string> | null;
  readonly exportName: string;
  readonly localName: string;
  readonly namespace: boolean;
}

/** Child attachment inferred from the direct syntax below one ancestor JSX wrapper. */
interface ParentChildSlot {
  readonly childMode: PreviewParentSliceChildMode;
}

/** Reproducible wrapper plus whether an unsupported boundary prevents climbing any farther. */
interface ReadAncestorFramesResult {
  readonly complete: boolean;
  readonly frames: readonly PreviewParentSliceFrame[];
  readonly limitReached: boolean;
}

/**
 * Finds exact imported target JSX usages and records only each usage's ancestor wrapper branch.
 *
 * Relative imports are matched lexically against `targetPath`. Alias imports may be supplied
 * explicitly and otherwise require a complete slash-delimited suffix match. Target occurrences
 * with zero attributes are retained, while all captured props remain primitive and inert.
 *
 * @param options Consumer text, paths, and selected target runtime export names.
 * @returns Bounded slices in source order plus parser and ceiling metadata.
 */
export function analyzePreviewParentSlices(
  options: AnalyzePreviewParentSlicesOptions,
): PreviewParentSliceAnalysis {
  validateAbsolutePaths(options.consumerPath, options.targetPath);
  if (Buffer.byteLength(options.sourceText, 'utf8') > MAX_CONSUMER_SOURCE_BYTES) {
    return { limitReached: true, slices: [], status: 'source-too-large' };
  }

  const sourceFile = ts.createSourceFile(
    options.consumerPath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(options.consumerPath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return { limitReached: false, slices: [], status: 'parse-error' };
  }

  const selectedExportNames = [...new Set(options.targetExportNames)].slice(0, MAX_TARGET_EXPORTS);
  const exportLimitReached = new Set(options.targetExportNames).size > selectedExportNames.length;
  if (selectedExportNames.length === 0) {
    return { limitReached: exportLimitReached, slices: [], status: 'ok' };
  }
  const importBindings = collectPreviewParentSliceImportBindings(sourceFile);
  const targetReferences = collectTargetImportReferences(
    importBindings,
    options,
    new Set(selectedExportNames),
  );
  if (targetReferences.size === 0) {
    return { limitReached: exportLimitReached, slices: [], status: 'ok' };
  }

  const slices: PreviewParentSlice[] = [];
  let frameLimitReached = false;

  /** Visits parsed syntax without resolving identifiers or evaluating any expression. */
  function visit(node: ts.Node): void {
    if (slices.length >= MAX_TARGET_USAGES) {
      return;
    }
    const opening = readJsxOpening(node);
    if (opening !== undefined) {
      const tagReference = readJsxTagReference(opening.tagName);
      const targetReference =
        tagReference === undefined
          ? undefined
          : matchTargetReference(tagReference, targetReferences);
      if (targetReference !== undefined) {
        const targetContainer = ts.isJsxElement(node) ? node : opening;
        const ancestorResult = readAncestorFrames(
          targetContainer,
          sourceFile,
          importBindings,
          options.consumerPath,
        );
        frameLimitReached ||= ancestorResult.limitReached;
        slices.push({
          complete: ancestorResult.complete,
          consumerPath: path.normalize(options.consumerPath),
          frames: ancestorResult.frames,
          occurrenceStart: opening.getStart(sourceFile),
          owner: readSliceOwner(targetContainer, sourceFile),
          targetExportName: targetReference.exportName,
          targetLocalName: targetReference.localName,
          targetProps: readPreviewParentSliceStaticProps(opening.attributes),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return {
    limitReached: exportLimitReached || slices.length >= MAX_TARGET_USAGES || frameLimitReached,
    slices,
    status: 'ok',
  };
}

/**
 * Finds JSX usages of one top-level source-local component so reverse analysis can cross a local
 * owner boundary before looking for the next imported parent. This covers source layouts where a
 * leaf lives inside `Body`, while `Body` is later placed below a Form or Provider in the same file.
 * Property accesses and imported identifiers remain fail-closed.
 *
 * @param options Consumer text/path and an exact top-level local component declaration name.
 * @returns Bounded local usages using the same inner-to-outer frame representation as imports.
 */
export function analyzePreviewLocalParentSlices(
  options: AnalyzePreviewLocalParentSlicesOptions,
): PreviewParentSliceAnalysis {
  if (!path.isAbsolute(options.consumerPath)) {
    throw new RangeError('Preview local parent-slice consumer path must be absolute.');
  }
  if (Buffer.byteLength(options.sourceText, 'utf8') > MAX_CONSUMER_SOURCE_BYTES) {
    return { limitReached: true, slices: [], status: 'source-too-large' };
  }

  const sourceFile = ts.createSourceFile(
    options.consumerPath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(options.consumerPath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return { limitReached: false, slices: [], status: 'parse-error' };
  }
  if (!hasTopLevelValueDeclaration(sourceFile, options.localComponentName)) {
    return { limitReached: false, slices: [], status: 'ok' };
  }

  const importBindings = collectPreviewParentSliceImportBindings(sourceFile);
  const slices: PreviewParentSlice[] = [];
  let limitReached = false;

  /** Visits only JSX tags spelling the selected source-local component identifier exactly. */
  function visit(node: ts.Node): void {
    if (slices.length >= MAX_TARGET_USAGES) {
      limitReached = true;
      return;
    }
    const opening = readJsxOpening(node);
    const tagReference = opening === undefined ? undefined : readJsxTagReference(opening.tagName);
    if (
      opening !== undefined &&
      tagReference?.rootName === options.localComponentName &&
      tagReference.memberPath.length === 0
    ) {
      const targetContainer = ts.isJsxElement(node) ? node : opening;
      const ancestorResult = readAncestorFrames(
        targetContainer,
        sourceFile,
        importBindings,
        options.consumerPath,
      );
      limitReached ||= ancestorResult.limitReached;
      slices.push({
        complete: ancestorResult.complete,
        consumerPath: path.normalize(options.consumerPath),
        frames: ancestorResult.frames,
        occurrenceStart: opening.getStart(sourceFile),
        owner: readSliceOwner(targetContainer, sourceFile),
        targetExportName: options.localComponentName,
        targetLocalName: options.localComponentName,
        targetProps: readPreviewParentSliceStaticProps(opening.attributes),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { limitReached, slices, status: 'ok' };
}

/**
 * Confirms that a local reverse-climb name belongs to a top-level runtime declaration.
 *
 * @param sourceFile Parsed consumer module.
 * @param localName Exact identifier requested by the preceding owner analysis.
 * @returns `true` for a function, class, or variable value declared by the module.
 */
function hasTopLevelValueDeclaration(sourceFile: ts.SourceFile, localName: string): boolean {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === localName
    ) {
      return true;
    }
    if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === localName,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validates the only filesystem identities accepted by lexical import comparison.
 *
 * @param consumerPath Path of the in-memory source being parsed.
 * @param targetPath Path of the selected component module.
 */
function validateAbsolutePaths(consumerPath: string, targetPath: string): void {
  if (!path.isAbsolute(consumerPath) || !path.isAbsolute(targetPath)) {
    throw new RangeError('Preview parent-slice consumer and target paths must be absolute.');
  }
}

/**
 * Selects each direct target import binding and associates namespace roots with later JSX members.
 *
 * @param importBindings All runtime imports in the consumer module.
 * @param options Target path, selected exports, and optional accepted aliases.
 * @param selectedExports Runtime export-name allowlist.
 * @returns Target references keyed by consumer-local import root.
 */
function collectTargetImportReferences(
  importBindings: ReadonlyMap<string, PreviewParentSliceImportBinding>,
  options: AnalyzePreviewParentSlicesOptions,
  selectedExports: ReadonlySet<string>,
): ReadonlyMap<string, TargetImportReference> {
  const acceptedSpecifiers = new Set(
    options.acceptedTargetImportSpecifiers?.map(cleanAcceptedSpecifier) ?? [],
  );
  const references = new Map<string, TargetImportReference>();

  for (const binding of importBindings.values()) {
    const lexicallyMatches = matchesPreviewParentSliceTargetImport(
      binding.moduleSpecifier,
      options.consumerPath,
      options.targetPath,
      acceptedSpecifiers,
    );
    if (
      !lexicallyMatches &&
      options.matchesTargetImport?.(
        binding.moduleSpecifier,
        options.consumerPath,
        options.targetPath,
      ) !== true
    ) {
      continue;
    }
    if (binding.importedName === '*') {
      references.set(binding.localName, {
        allowedNamespaceExports: selectedExports,
        exportName: '*',
        localName: binding.localName,
        namespace: true,
      });
    } else if (selectedExports.has(binding.importedName)) {
      references.set(binding.localName, {
        allowedNamespaceExports: null,
        exportName: binding.importedName,
        localName: binding.localName,
        namespace: false,
      });
    }
  }
  return references;
}

/**
 * Normalizes an accepted alias exactly as authored import specifiers are normalized.
 *
 * @param specifier Caller-approved alias string.
 * @returns Query-free slash-normalized alias used only for exact set membership.
 */
function cleanAcceptedSpecifier(specifier: string): string {
  return specifier.split(/[?#]/u, 1)[0]?.replaceAll('\\', '/') ?? '';
}

/**
 * Matches an identifier or namespace-member JSX tag to one selected direct target import.
 *
 * @param tagReference Parsed JSX tag root and property path.
 * @param targetReferences Target imports keyed by local root.
 * @returns Exact selected target export, or `undefined` for members of ordinary imports.
 */
function matchTargetReference(
  tagReference: JsxTagReference,
  targetReferences: ReadonlyMap<string, TargetImportReference>,
): TargetImportReference | undefined {
  const reference = targetReferences.get(tagReference.rootName);
  if (reference === undefined) {
    return undefined;
  }
  if (!reference.namespace) {
    return tagReference.memberPath.length === 0 ? reference : undefined;
  }
  if (tagReference.memberPath.length !== 1) {
    return undefined;
  }
  const exportName = tagReference.memberPath[0];
  return exportName === undefined || !reference.allowedNamespaceExports?.has(exportName)
    ? undefined
    : {
        allowedNamespaceExports: reference.allowedNamespaceExports,
        exportName,
        localName: reference.localName,
        namespace: true,
      };
}

/**
 * Reads every safely reproducible JSX wrapper from the target outward to its owning declaration.
 *
 * Unsupported local component wrappers form a hard boundary: outer wrappers are not claimed to be
 * direct ancestors after an irreplaceable provider or layout component has been omitted.
 *
 * @param targetContainer Full target JSX element or its self-closing opening node.
 * @param sourceFile Parsed consumer source.
 * @param importBindings Consumer runtime imports used to classify component wrapper tags.
 * @param sourcePath Absolute consumer path attached to every frame.
 * @returns Inner-to-outer frames and completeness/limit metadata.
 */
function readAncestorFrames(
  targetContainer: ts.Node,
  sourceFile: ts.SourceFile,
  importBindings: ReadonlyMap<string, PreviewParentSliceImportBinding>,
  sourcePath: string,
): ReadAncestorFramesResult {
  const frames: PreviewParentSliceFrame[] = [];
  let current: ts.Node = targetContainer;
  let complete = true;
  let limitReached = false;

  while (current.parent !== sourceFile) {
    const parent = current.parent;
    if (isOwnedFunctionBoundary(parent)) {
      break;
    }
    if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) {
      if (frames.length >= MAX_ANCESTOR_FRAMES) {
        complete = false;
        limitReached = true;
        break;
      }
      const opening = ts.isJsxElement(parent) ? parent.openingElement : parent;
      const tagReference = readJsxTagReference(opening.tagName);
      const childSlot = readParentChildSlot(current, parent);
      if (tagReference === undefined || childSlot === undefined) {
        complete = false;
        break;
      }
      const frame = createAncestorFrame(
        tagReference,
        childSlot,
        opening.attributes,
        importBindings,
        sourcePath,
      );
      if (frame === undefined) {
        complete = false;
        break;
      }
      frames.push(frame);
    }
    current = parent;
  }

  return { complete, frames, limitReached };
}

/**
 * Recognizes a function that belongs to a source declaration rather than a JSX render-prop slot.
 *
 * @param node Candidate lexical boundary reached while walking out of the target JSX branch.
 * @returns `true` when ancestor JSX cannot exist outside this component render function.
 */
function isOwnedFunctionBoundary(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node)) {
    return true;
  }
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
    return false;
  }
  let current: ts.Node = node;
  while (!ts.isSourceFile(current)) {
    const parent = current.parent;
    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      return true;
    }
    if (ts.isExportAssignment(parent) && parent.expression === current) {
      return true;
    }
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (ts.isCallExpression(parent) && parent.arguments.includes(current as ts.Expression)) {
      current = parent;
      continue;
    }
    break;
  }
  return false;
}

/**
 * Creates an intrinsic or direct-import wrapper frame from one JSX ancestor opening element.
 *
 * @param tagReference Parsed wrapper tag identity.
 * @param childSlot How the inner target branch enters the wrapper.
 * @param attributes Wrapper attributes inspected for inert primitive props.
 * @param importBindings Runtime imports available in the consumer.
 * @param sourcePath Consumer path recorded for later bundler resolution and hot reload.
 * @returns A reproducible frame, or `undefined` for an unsupported local component wrapper.
 */
function createAncestorFrame(
  tagReference: JsxTagReference,
  childSlot: ParentChildSlot,
  attributes: ts.JsxAttributes,
  importBindings: ReadonlyMap<string, PreviewParentSliceImportBinding>,
  sourcePath: string,
): PreviewParentSliceFrame | undefined {
  const props = readPreviewParentSliceStaticProps(attributes);
  if (isIntrinsicTagReference(tagReference)) {
    return {
      ...childSlot,
      kind: 'intrinsic',
      props,
      tagName: tagReference.tagName,
    };
  }

  const binding = importBindings.get(tagReference.rootName);
  if (
    binding === undefined ||
    binding.importedName === '*' ||
    tagReference.memberPath.length > 0 ||
    hasUnsafePreviewParentSliceRuntimeAttributes(attributes)
  ) {
    return undefined;
  }
  return {
    ...childSlot,
    importReference: {
      consumerSourcePath: path.normalize(sourcePath),
      exportName: binding.importedName,
      moduleSpecifier: binding.moduleSpecifier,
    },
    kind: 'imported',
    props,
  };
}

/**
 * Infers whether one target branch is passed as normal JSX children or through a render function.
 *
 * @param innerNode Immediate descendant on the active branch before the wrapper node.
 * @param wrapper Ancestor JSX element receiving that branch.
 * @returns A clear child slot, or `undefined` for spread/indirect callback syntax.
 */
function readParentChildSlot(
  innerNode: ts.Node,
  wrapper: ts.JsxElement | ts.JsxSelfClosingElement,
): ParentChildSlot | undefined {
  const directDescendant = findDirectDescendant(innerNode, wrapper);
  if (directDescendant === undefined) {
    return undefined;
  }

  if (ts.isJsxElement(wrapper) && wrapper.children.includes(directDescendant as ts.JsxChild)) {
    const childFunction = readDirectSlotFunction(directDescendant);
    return {
      childMode: childFunction ? 'render-function' : 'children',
    };
  }
  return undefined;
}

/**
 * Finds the direct child of an ancestor wrapper that contains the active inner branch.
 *
 * @param innerNode Node currently known to contain the selected target.
 * @param wrapper Candidate ancestor JSX wrapper.
 * @returns The wrapper's immediate descendant on that branch.
 */
function findDirectDescendant(innerNode: ts.Node, wrapper: ts.Node): ts.Node | undefined {
  let current = innerNode;
  while (current.parent !== wrapper) {
    if (ts.isSourceFile(current.parent)) {
      return undefined;
    }
    current = current.parent;
  }
  return current.parent === wrapper ? current : undefined;
}

/**
 * Detects a render-prop function only when it is the direct value of a JSX child expression.
 *
 * @param directChild Wrapper child node on the selected target branch.
 * @returns `true` for syntactically explicit arrow/function children.
 */
function readDirectSlotFunction(directChild: ts.Node): boolean {
  if (!ts.isJsxExpression(directChild) || directChild.expression === undefined) {
    return false;
  }
  return isFunctionExpression(unwrapExpression(directChild.expression));
}

/**
 * Removes syntax-only expression wrappers before a render-function classification.
 *
 * @param expression Parsed child or attribute expression.
 * @returns Innermost expression with equivalent runtime identity.
 */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Reports whether an expression creates a callable render slot without executing it.
 *
 * @param expression Unwrapped JSX child or attribute expression.
 * @returns `true` for arrow or traditional function expressions.
 */
function isFunctionExpression(expression: ts.Expression): boolean {
  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
}

/**
 * Reads one JSX element's opening node without treating standalone opening syntax as a usage twice.
 *
 * @param node Parsed syntax visited in source order.
 * @returns Opening element for a full or self-closing JSX element.
 */
function readJsxOpening(node: ts.Node): ts.JsxOpeningLikeElement | undefined {
  if (ts.isJsxSelfClosingElement(node)) {
    return node;
  }
  return ts.isJsxElement(node) ? node.openingElement : undefined;
}

/**
 * Decomposes identifier/property-access JSX tags into an import root and bounded member path.
 *
 * @param tagName Parsed JSX tag expression.
 * @returns Reproducible tag reference, or `undefined` for namespaced/overly deep syntax.
 */
function readJsxTagReference(tagName: ts.JsxTagNameExpression): JsxTagReference | undefined {
  if (ts.isIdentifier(tagName)) {
    return { memberPath: [], rootName: tagName.text, tagName: tagName.text };
  }
  if (!ts.isPropertyAccessExpression(tagName)) {
    return undefined;
  }

  const members: string[] = [];
  let current: ts.Expression = tagName;
  while (ts.isPropertyAccessExpression(current) && members.length < MAX_JSX_MEMBER_DEPTH) {
    members.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isIdentifier(current) || members.length === 0 || members.length >= MAX_JSX_MEMBER_DEPTH) {
    return undefined;
  }
  return {
    memberPath: members,
    rootName: current.text,
    tagName: `${current.text}.${members.join('.')}`,
  };
}

/**
 * Classifies lowercase identifiers and hyphenated custom elements as intrinsic JSX wrappers.
 *
 * @param tagReference Parsed tag identity.
 * @returns `true` only when no runtime import is needed to recreate the wrapper.
 */
function isIntrinsicTagReference(tagReference: JsxTagReference): boolean {
  return (
    tagReference.memberPath.length === 0 &&
    (/^[a-z]/u.test(tagReference.rootName) || tagReference.rootName.includes('-'))
  );
}

/**
 * Finds the source-level component declaration containing a target usage for later reverse climbs.
 *
 * @param targetContainer Selected JSX usage node.
 * @param sourceFile Parsed consumer module used to inspect export declarations.
 * @returns Local/export owner metadata, or `null` when no declarative owner is recognizable.
 */
function readSliceOwner(
  targetContainer: ts.Node,
  sourceFile: ts.SourceFile,
): PreviewParentSliceOwner | null {
  let current: ts.Node = targetContainer;
  while (current !== sourceFile) {
    if (ts.isFunctionDeclaration(current)) {
      const localName = current.name?.text ?? null;
      return {
        exportNames: readDeclarationExportNames(current, localName, sourceFile),
        localName,
      };
    }
    if (ts.isClassDeclaration(current)) {
      const localName = current.name?.text ?? null;
      return {
        exportNames: readDeclarationExportNames(current, localName, sourceFile),
        localName,
      };
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return {
        exportNames: readVariableExportNames(current, sourceFile),
        localName: current.name.text,
      };
    }
    if (ts.isExportAssignment(current) && isFunctionExpression(current.expression)) {
      return { exportNames: ['default'], localName: null };
    }
    current = current.parent;
  }
  return null;
}

/**
 * Reads direct modifiers and later export-list aliases for a function or class declaration.
 *
 * @param declaration Named or anonymous function/class owning the target usage.
 * @param localName Declaration-local name when present.
 * @param sourceFile Consumer source containing possible export lists and assignments.
 * @returns Stable runtime export names referring to the declaration.
 */
function readDeclarationExportNames(
  declaration: ts.FunctionDeclaration | ts.ClassDeclaration,
  localName: string | null,
  sourceFile: ts.SourceFile,
): readonly string[] {
  const names: string[] = [];
  if (hasModifier(declaration, ts.SyntaxKind.DefaultKeyword)) {
    names.push('default');
  } else if (localName !== null && hasModifier(declaration, ts.SyntaxKind.ExportKeyword)) {
    names.push(localName);
  }
  if (localName !== null) {
    appendExportAliases(names, localName, sourceFile);
  }
  return [...new Set(names)];
}

/**
 * Reads export modifiers from the containing variable statement and later export aliases.
 *
 * @param declaration Variable whose initializer owns the target JSX.
 * @param sourceFile Consumer source containing possible export lists and assignments.
 * @returns Stable runtime export names referring to the local variable.
 */
function readVariableExportNames(
  declaration: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
): readonly string[] {
  if (!ts.isIdentifier(declaration.name)) {
    return [];
  }
  const names: string[] = [];
  const declarationList = declaration.parent;
  const statement = declarationList.parent;
  if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    names.push(declaration.name.text);
  }
  appendExportAliases(names, declaration.name.text, sourceFile);
  return [...new Set(names)];
}

/**
 * Appends named/default aliases exported later from one source-local declaration.
 *
 * @param names Mutable stable result list.
 * @param localName Source-local declaration name.
 * @param sourceFile Consumer source containing export declarations and assignments.
 */
function appendExportAliases(names: string[], localName: string, sourceFile: ts.SourceFile): void {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      if (statement.expression.text === localName && !statement.isExportEquals) {
        names.push('default');
      }
      continue;
    }
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier !== undefined ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly || (element.propertyName ?? element.name).text !== localName) {
        continue;
      }
      names.push(element.name.text);
    }
  }
}

/**
 * Tests a declaration modifier without assuming that every declaration kind exposes modifiers.
 *
 * @param node Declaration inspected for an export/default keyword.
 * @param modifierKind Exact syntax kind to locate.
 * @returns `true` when the declaration carries the requested modifier.
 */
function hasModifier(node: ts.Node, modifierKind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === modifierKind) ?? false)
    : false;
}

/**
 * Selects TypeScript's JSX-aware parser grammar from one supported consumer source suffix.
 *
 * @param sourcePath Absolute consumer source path.
 * @returns TypeScript parser mode that preserves JSX nodes and parent links.
 */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const normalizedPath = sourcePath.toLowerCase();
  if (normalizedPath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (/\.(?:cts|mts|ts)$/u.test(normalizedPath)) {
    return ts.ScriptKind.TS;
  }
  return normalizedPath.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
}

/**
 * Rejects parser recovery so incomplete imports or JSX cannot produce misleading wrapper plans.
 *
 * @param sourceFile Parsed consumer module.
 * @returns `true` when TypeScript recorded at least one syntax diagnostic.
 */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}
