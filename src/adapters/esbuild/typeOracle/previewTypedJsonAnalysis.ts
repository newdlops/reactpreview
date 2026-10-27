/**
 * Parses private type-program or read-only declaration projections of large GraphQL document JSON.
 * Runtime transforms must never use these trees. Original text and offsets remain available;
 * removed literal subtrees retain their original traversal cost for bounded inference.
 */
import ts from 'typescript';

const projectedNodeCosts = new WeakMap<ts.Node, number>();
const MIN_PAYLOAD_CHARACTERS = 1024;
const MAX_JSON_DEPTH = 128;
const CANDIDATE_PREFIX = /^[\t ]*export const ([$A-Z_a-z][$\w]*) = /gm;
const ASSERTION_SEPARATOR = ' as unknown as ';

interface DocumentSpan {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly statementStart: number;
  readonly semicolonStart: number;
  readonly nodeCost: number;
}

/** Returns the original child-traversal charge, including JSON nodes omitted from this tree. */
export function readPreviewTypeAnalysisNodeCost(node: ts.Node): number {
  return projectedNodeCosts.get(node) ?? 1;
}

/**
 * Builds an analysis-only parse; any uncertain projection falls back to the untouched source.
 * Candidate discovery is intentionally insufficient on its own: every span must attach to an
 * actual top-level, explicitly terminated, double-cast declaration in the parsed projection.
 */
export function createPreviewTypeAnalysisSourceFile(
  fileName: string,
  text: string,
  languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions,
): ts.SourceFile {
  if (/\.[cm]?ts$/u.test(fileName) && !/\.d\.[cm]?ts$/u.test(fileName)) {
    try {
      const projection = projectDocumentJson(text);
      if (projection !== undefined) {
        const file = ts.createSourceFile(fileName, projection.text, languageVersion, true);
        if (attachDocumentSpans(file, projection.spans)) {
          Object.assign(file, { text });
          return file;
        }
      }
    } catch {
      // A workspace input or detector failure must not disable type analysis for other files.
    }
  }
  return ts.createSourceFile(fileName, text, languageVersion, true);
}

/** Discovers literal candidates without changing line terminators or UTF-16 positions. */
function projectDocumentJson(
  text: string,
): { readonly text: string; readonly spans: readonly DocumentSpan[] } | undefined {
  if (!text.includes(' as unknown as ') || !text.includes('DocumentNode<')) return undefined;
  const spans: DocumentSpan[] = [];
  const pieces: string[] = [];
  let copiedUntil = 0;
  for (const match of text.matchAll(CANDIDATE_PREFIX)) {
    const name = match[1];
    if (name === undefined) continue;
    const start = match.index + match[0].length;
    const newline = text.indexOf('\n', start);
    const line = text.slice(start, newline === -1 ? text.length : newline).trimEnd();
    if (!line.endsWith('>;') || /[\r\n\u2028\u2029]/u.test(line)) continue;
    // One suffix lookup per line avoids rescanning fake cast text inside JSON strings.
    const assertionStart = line.lastIndexOf(ASSERTION_SEPARATOR);
    if (assertionStart < MIN_PAYLOAD_CHARACTERS) continue;
    const assertedType = line.slice(assertionStart + ASSERTION_SEPARATOR.length);
    if (!assertedType.startsWith('DocumentNode<') && !assertedType.startsWith('TypedDocumentNode<'))
      continue;
    const payload = line.slice(0, assertionStart);
    if (!payload.startsWith('{') || !payload.endsWith('}')) continue;
    const nodeCost = readDocumentJsonNodeCost(payload);
    if (nodeCost === undefined) continue;
    const end = start + payload.length;
    if (start < copiedUntil) return undefined;
    pieces.push(text.slice(copiedUntil, start), 'null', ' '.repeat(payload.length - 4));
    copiedUntil = end;
    spans.push({
      name,
      start,
      end,
      statementStart: match.index + match[0].indexOf('export const'),
      semicolonStart: start + line.length - 1,
      nodeCost,
    });
  }
  if (spans.length === 0) return undefined;
  pieces.push(text.slice(copiedUntil));
  return { text: pieces.join(''), spans };
}

/**
 * Counts strict JSON syntax tokens, not decoded object values: duplicate keys must still cost
 * their property/name/value nodes. Minus creates one unary-expression node; exponent signs do not.
 */
function readDocumentJsonNodeCost(payload: string): number | undefined {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    value.kind !== 'Document' ||
    !('definitions' in value) ||
    !Array.isArray(value.definitions)
  ) {
    return undefined;
  }
  let count = 0;
  let depth = 0;
  for (let index = 0; index < payload.length; index += 1) {
    const character = payload[index];
    if (character === '"') {
      count += 1;
      for (index += 1; index < payload.length; index += 1) {
        if (payload[index] === '\\') index += 1;
        else if (payload[index] === '"') break;
      }
    } else if (character === '{' || character === '[') {
      count += 1;
      depth += 1;
      if (depth > MAX_JSON_DEPTH) return undefined;
    } else if (character === '}' || character === ']') {
      depth -= 1;
    } else if (character === ':') {
      count += 1;
    } else if (character === 't' || character === 'f' || character === 'n') {
      count += 1;
      index += character === 'f' ? 4 : 3;
    } else if (character === '-' || (character !== undefined && /[0-9]/u.test(character))) {
      count += character === '-' ? 2 : 1;
      while (index + 1 < payload.length && /[0-9eE+.\-]/u.test(payload.charAt(index + 1)))
        index += 1;
    }
  }
  return count;
}

/** Verifies all replacements before mutating ranges, storing costs, or exposing the tree. */
function attachDocumentSpans(file: ts.SourceFile, spans: readonly DocumentSpan[]): boolean {
  const diagnostics = (
    file as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if ((diagnostics?.length ?? 0) > 0) return false;
  const remaining = new Map(spans.map((span) => [span.start, span]));
  const attachments: { readonly node: ts.Node; readonly span: DocumentSpan }[] = [];
  for (const statement of file.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      statement.modifiers?.length !== 1 ||
      statement.modifiers[0]?.kind !== ts.SyntaxKind.ExportKeyword ||
      statement.declarationList.flags !== ts.NodeFlags.Const ||
      statement.declarationList.declarations.length !== 1
    ) {
      continue;
    }
    const declaration = statement.declarationList.declarations[0];
    const initializer = declaration?.initializer;
    if (
      declaration === undefined ||
      !ts.isIdentifier(declaration.name) ||
      declaration.type !== undefined ||
      declaration.exclamationToken !== undefined ||
      initializer === undefined ||
      !ts.isAsExpression(initializer) ||
      !ts.isTypeReferenceNode(initializer.type) ||
      !ts.isIdentifier(initializer.type.typeName) ||
      !['DocumentNode', 'TypedDocumentNode'].includes(initializer.type.typeName.text) ||
      initializer.type.typeArguments?.length !== 2 ||
      !ts.isAsExpression(initializer.expression) ||
      initializer.expression.type.kind !== ts.SyntaxKind.UnknownKeyword
    ) {
      continue;
    }
    const node = initializer.expression.expression;
    const span = remaining.get(node.getStart(file));
    if (
      span === undefined ||
      node.kind !== ts.SyntaxKind.NullKeyword ||
      node.end !== span.start + 4 ||
      declaration.name.text !== span.name ||
      initializer.getStart(file) !== span.start ||
      statement.getStart(file) !== span.statementStart ||
      initializer.end !== span.semicolonStart ||
      declaration.end !== span.semicolonStart ||
      statement.end !== span.semicolonStart + 1
    ) {
      continue;
    }
    attachments.push({ node, span });
    remaining.delete(span.start);
  }
  if (remaining.size > 0 || attachments.length !== spans.length) return false;
  for (const { node, span } of attachments) {
    ts.setTextRange(node, { pos: node.pos, end: span.end });
    projectedNodeCosts.set(node, span.nodeCost);
  }
  return true;
}
