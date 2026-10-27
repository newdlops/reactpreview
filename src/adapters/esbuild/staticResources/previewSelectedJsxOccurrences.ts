/** Carries exact selected JSX sites through source rewrites without moving typed-analysis offsets. */
import path from 'node:path';
import ts from 'typescript';
import {
  createPreviewJsxOccurrenceId,
  PREVIEW_JSX_OCCURRENCE_PROP,
} from '../previewJsxOccurrenceIdentity';
import {
  readPreviewJsxOccurrenceMarker,
  readPreviewSelectedTargetNames,
} from './previewSelectedTargetExit';

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

/** One module's private annotation plan, retained only for the current transform call. */
export interface PreviewSelectedJsxOccurrences {
  /** Authored target bindings, including non-JSX selected helper references. */
  readonly names?: ReadonlySet<string>;
  /** Adds compiler metadata only if the complete authored JSX order remains intact. */
  readonly apply: (rewritten: string) => string;
}

/**
 * Measures selected sites before compatibility rewriting, then annotates after typed analyses.
 * Any changed JSX order fails closed; already annotated export slices preserve their original IDs.
 */
export function createPreviewSelectedJsxOccurrences(
  occurrences: ReadonlyMap<string, readonly number[]> | undefined,
  sourcePath: string,
  sourceText: string,
  trackSites = true,
): PreviewSelectedJsxOccurrences {
  const offsets = occurrences?.get(path.normalize(sourcePath));
  if ((offsets?.length ?? 0) === 0 && !sourceText.includes(PREVIEW_JSX_OCCURRENCE_PROP)) {
    return { apply: (rewritten) => rewritten };
  }
  const original = parse(sourcePath, sourceText);
  const openings = collectOpenings(original);
  const marked = openings.filter(
    (opening) => readPreviewJsxOccurrenceMarker(opening) !== undefined,
  );
  const names = new Set(readPreviewSelectedTargetNames(original, offsets ?? []));
  for (const opening of marked) {
    if (ts.isIdentifier(opening.tagName)) names.add(opening.tagName.text);
  }
  const selected = new Map<number, string>();
  if (trackSites && marked.length === 0) {
    for (const [index, opening] of openings.entries()) {
      if (
        offsets?.some(
          (offset) =>
            offset === opening.getStart(original) || offset === opening.tagName.getStart(original),
        ) &&
        !opening.attributes.properties.some(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(original) === PREVIEW_JSX_OCCURRENCE_PROP,
        )
      )
        selected.set(index, createPreviewJsxOccurrenceId(sourcePath, opening.getStart(original)));
    }
  }
  return {
    ...(names.size === 0 ? {} : { names }),
    apply(rewritten): string {
      if (selected.size === 0) return rewritten;
      const rewrittenFile = rewritten === sourceText ? original : parse(sourcePath, rewritten);
      const current = rewrittenFile === original ? openings : collectOpenings(rewrittenFile);
      if (
        current.length !== openings.length ||
        current.some(
          (opening, index) =>
            opening.tagName.getText(rewrittenFile) !== openings[index]?.tagName.getText(original),
        )
      )
        return rewritten;
      let result = rewritten;
      for (const [index, id] of [...selected].reverse()) {
        const opening = current[index];
        if (opening === undefined) continue;
        const end = opening.tagName.end;
        result =
          result.slice(0, end) +
          ` ${PREVIEW_JSX_OCCURRENCE_PROP}=${JSON.stringify(id)}` +
          result.slice(end);
      }
      return result;
    },
  };
}

/** Parses only a selected owner, using the grammar accepted by runtime JSX instrumentation. */
function parse(sourcePath: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?ts$/iu.test(sourcePath) ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );
}

/** Keeps original source traversal order, including independent same-name JSX occurrences. */
function collectOpenings(sourceFile: ts.SourceFile): Opening[] {
  const openings: Opening[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) openings.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return openings;
}
