/**
 * Recognizes early exits whose returned JSX renders the selected Page Inspector target.
 *
 * Guard analyses normally choose values that continue past `if (...) return <Fallback />` so the
 * page body below the guard can mount. When the returned JSX is the selected target itself, such as
 * a login page behind `if (!token) return <Routes><Route element={<LoginPage />} /></Routes>`,
 * continuing past the guard hides the target behind the authenticated shell. The compiler records
 * the component names rendered at the target's proven occurrences in each owner module; an exit
 * that renders one of them while the rest of its component does not is the target branch.
 * Ambiguous components rendered on both sides keep the existing continuation behavior.
 */
import path from 'node:path';
import ts from 'typescript';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { PREVIEW_JSX_OCCURRENCE_PROP } from '../previewJsxOccurrenceIdentity';

/** Component names rendered at the selected target's occurrences, per parsed module. */
const targetNamesBySourceFile = new WeakMap<ts.SourceFile, ReadonlySet<string>>();
const targetOccurrencesBySourceFile = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

/**
 * Records the target component names for one parsed module before its guards are analyzed.
 *
 * @param sourceFile Parsed module whose analyses consult the names.
 * @param names Target component names; absent or empty leaves every analysis unchanged.
 */
export function registerPreviewSelectedTargetNames(
  sourceFile: ts.SourceFile,
  names: ReadonlySet<string> | undefined,
): void {
  if (names !== undefined && names.size > 0) targetNamesBySourceFile.set(sourceFile, names);
  const occurrences = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const id = readPreviewJsxOccurrenceMarker(node);
      if (id !== undefined) occurrences.add(id);
    }
    ts.forEachChild(node, visit);
  };
  if (sourceFile.text.includes(PREVIEW_JSX_OCCURRENCE_PROP)) visit(sourceFile);
  if (occurrences.size > 0) targetOccurrencesBySourceFile.set(sourceFile, occurrences);
}

/** Reads only an inert compiler marker attribute; expressions and spreads never qualify. */
export function readPreviewJsxOccurrenceMarker(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string | undefined {
  for (const attribute of opening.attributes.properties) {
    if (
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === PREVIEW_JSX_OCCURRENCE_PROP &&
      attribute.initializer !== undefined &&
      ts.isStringLiteral(attribute.initializer) &&
      /^rpi:[a-f0-9]{32}$/u.test(attribute.initializer.text)
    )
      return attribute.initializer.text;
  }
  return undefined;
}

/** Chooses a branch only when one exact selected JSX site occurs on that side alone. */
export function readPreviewSelectedTargetBranch(
  truthy: ts.Node,
  falsy?: ts.Node,
): {
  readonly targetBranch?: 'falsy' | 'truthy';
  readonly targetBranchEvidence?: 'selected-target';
} {
  const sourceFile = truthy.getSourceFile();
  if (!targetOccurrencesBySourceFile.has(sourceFile)) return {};
  const names = targetNamesBySourceFile.get(sourceFile) ?? new Set<string>();
  const left = referencesTarget(truthy, names);
  const right = falsy !== undefined && referencesTarget(falsy, names);
  return left === right
    ? {}
    : {
        targetBranch: left ? 'truthy' : 'falsy',
        targetBranchEvidence: 'selected-target',
      };
}

/**
 * Groups the selected page path's child occurrences by owner module.
 *
 * @param edges Child-to-owner relationships of the executed page candidate.
 * @param renderPath Exact executed value-flow path, including non-JSX helper calls.
 * @returns Occurrence offsets keyed by normalized canonical owner path.
 */
export function createPreviewSelectedTargetOccurrences(
  edges: readonly {
    readonly occurrenceStart: number;
    readonly owner: { readonly sourcePath: string };
  }[],
  renderPath?: {
    readonly steps: readonly { readonly sourcePath: string; readonly occurrenceStart: number }[];
  },
): ReadonlyMap<string, readonly number[]> {
  const occurrences = new Map<string, number[]>();
  for (const edge of edges) {
    const key = path.normalize(canonicalizeExistingPath(edge.owner.sourcePath));
    occurrences.set(key, [...(occurrences.get(key) ?? []), edge.occurrenceStart]);
  }
  for (let index = 0; index + 1 < (renderPath?.steps.length ?? 0); index += 1) {
    const child = renderPath?.steps[index];
    const owner = renderPath?.steps[index + 1];
    if (child === undefined || owner === undefined || child.occurrenceStart < 0) continue;
    const key = path.normalize(canonicalizeExistingPath(owner.sourcePath));
    const offsets = occurrences.get(key) ?? [];
    if (!offsets.includes(child.occurrenceStart)) offsets.push(child.occurrenceStart);
    occurrences.set(key, offsets);
  }
  return occurrences;
}

/**
 * Reads target component names for one module from the compiler's occurrence map.
 *
 * @param occurrences Target occurrence offsets keyed by normalized owner module path.
 * @param sourcePath Module being transformed.
 * @param sourceText Authored text the offsets were measured in, before any rewrite.
 * @returns Names to register for the module's analyses, or `undefined` when it has none.
 */
export function readPreviewSelectedTargetNamesForSource(
  occurrences: ReadonlyMap<string, readonly number[]> | undefined,
  sourcePath: string,
  sourceText: string,
): ReadonlySet<string> | undefined {
  const offsets = occurrences?.get(path.normalize(sourcePath));
  if (offsets === undefined || offsets.length === 0) return undefined;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?ts$/iu.test(sourcePath) ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );
  const names = readPreviewSelectedTargetNames(sourceFile, offsets);
  return names.size === 0 ? undefined : names;
}

/**
 * Reads the component names rendered at compiler-proven target occurrences of one module.
 *
 * @param sourceFile Authored module parsed from the same text the occurrences were measured in.
 * @param occurrenceStarts Offsets of the JSX elements (or references) that render the target.
 * @returns JSX tag or referenced identifier names found exactly at those offsets.
 */
export function readPreviewSelectedTargetNames(
  sourceFile: ts.SourceFile,
  occurrenceStarts: readonly number[],
): ReadonlySet<string> {
  const offsets = [...new Set(occurrenceStarts)].filter((offset) => Number.isSafeInteger(offset));
  const names = new Set<string>();
  if (offsets.length === 0) return names;
  const first = Math.min(...offsets);
  const last = Math.max(...offsets);
  const visit = (node: ts.Node): void => {
    const start = node.getStart(sourceFile);
    if (start > last || node.getEnd() <= first) return;
    if (offsets.includes(start)) {
      const name = readRenderedName(node);
      if (name !== undefined) names.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/**
 * Reports whether an early-exit branch renders the target while the rest of its component does not.
 *
 * @param exit Statement that returns or throws when its guard is taken.
 * @returns `true` when taking the exit, not continuing past it, reaches the selected target.
 */
export function isPreviewSelectedTargetExit(exit: ts.Statement): boolean {
  const names = targetNamesBySourceFile.get(exit.getSourceFile());
  if (names === undefined || !referencesTarget(exit, names)) return false;
  const owner = ts.findAncestor(exit.parent, ts.isFunctionLike);
  return owner !== undefined && !referencesTarget(owner, names, exit);
}

/** Proves taking or bypassing one terminal exit from the exact selected site in its owner. */
export function hasPreviewSelectedTargetExitPath(exit: ts.Statement): boolean {
  const sourceFile = exit.getSourceFile();
  if (!targetOccurrencesBySourceFile.has(sourceFile)) return false;
  const owner = ts.findAncestor(exit.parent, ts.isFunctionLike);
  if (owner === undefined) return false;
  const names = targetNamesBySourceFile.get(sourceFile) ?? new Set<string>();
  return referencesTarget(exit, names) !== referencesTarget(owner, names, exit);
}

/** Reads the JSX tag or identifier rendered by the node that starts at a target occurrence. */
function readRenderedName(node: ts.Node): string | undefined {
  const element = ts.isJsxElement(node) ? node.openingElement : node;
  if (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) {
    return ts.isIdentifier(element.tagName) ? element.tagName.text : undefined;
  }
  return ts.isIdentifier(node) ? node.text : undefined;
}

/** Finds a JSX tag or value reference to one of the names, skipping one subtree. */
function referencesTarget(node: ts.Node, names: ReadonlySet<string>, skipped?: ts.Node): boolean {
  if (node === skipped) return false;
  const occurrences = targetOccurrencesBySourceFile.get(node.getSourceFile());
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const id = readPreviewJsxOccurrenceMarker(node);
    if (occurrences !== undefined && id !== undefined && occurrences.has(id)) return true;
  }
  if (
    occurrences === undefined &&
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
    ts.isIdentifier(node.tagName) &&
    names.has(node.tagName.text)
  ) {
    return true;
  }
  if (
    occurrences === undefined &&
    ts.isIdentifier(node) &&
    names.has(node.text) &&
    isValueReference(node)
  )
    return true;
  return ts.forEachChild(node, (child) => referencesTarget(child, names, skipped)) === true;
}

/** Excludes property names, declarations, and import specifiers that merely share the name. */
function isValueReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return !(
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) &&
      parent.name === identifier) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isFunctionDeclaration(parent) && parent.name === identifier) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isJsxAttribute(parent)
  );
}

/** Branch roles of one early-return gate after checking whether its exit renders the target. */
export interface PreviewEarlyReturnBranchRoles {
  /** Whether the gate still continues past the exit, so continuation-only flags apply. */
  readonly continuesPastExit: boolean;
  /** Branch treated as the authored fallback. */
  readonly fallbackBranch: 'falsy' | 'truthy';
  /** Branch that leads to the selected target. */
  readonly targetBranch: 'falsy' | 'truthy';
}

/**
 * Chooses the target branch of a one-sided early-return gate.
 *
 * @param statement Guard whose one branch returns or throws.
 * @param returnedBranch Branch that leaves the component.
 * @returns The returned branch as the target when it renders the selected target; otherwise the
 *   continuation, as before.
 */
export function readPreviewEarlyReturnBranchRoles(
  statement: ts.IfStatement,
  returnedBranch: 'falsy' | 'truthy',
): PreviewEarlyReturnBranchRoles {
  const continuation = returnedBranch === 'truthy' ? 'falsy' : 'truthy';
  const exit = returnedBranch === 'truthy' ? statement.thenStatement : statement.elseStatement;
  return exit !== undefined && isPreviewSelectedTargetExit(exit)
    ? { continuesPastExit: false, fallbackBranch: continuation, targetBranch: returnedBranch }
    : { continuesPastExit: true, fallbackBranch: returnedBranch, targetBranch: continuation };
}
