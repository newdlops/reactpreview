/**
 * Finds Redux state property names whose presence project code may observe.
 *
 * The Redux seed may create an absent optional receiver (an API result such as
 * `getDriveReportResult`) only when no code can tell that it appeared: every access to the name
 * must dereference it (`x.name.a`, `x.name?.a`) or assign it (`state.name = payload`). A condition,
 * comparison, negation, return, argument, spread, `in`/`typeof` operand, or destructuring could
 * branch on the receiver's existence, so the name is reported as observed. The scan is syntactic and
 * name-based over the sources it is given (the compiler's frontier), so a presence check in a module
 * outside that frontier is not seen.
 */
import ts from 'typescript';

const MAX_SCANNED_SOURCE_LENGTH = 2_000_000;

/**
 * Returns the subset of `names` that some source reads in a way that can observe presence.
 *
 * @param sources Source text by absolute path; only sources containing a candidate name are parsed.
 * @param names Candidate receiver property names.
 * @returns Names with at least one presence-observing access.
 */
export function collectPreviewObservedReduxPropertyNames(
  sources: ReadonlyMap<string, string>,
  names: ReadonlySet<string>,
): ReadonlySet<string> {
  const observed = new Set<string>();
  if (names.size === 0) return observed;
  for (const [sourcePath, sourceText] of sources) {
    if (sourceText.length > MAX_SCANNED_SOURCE_LENGTH) {
      for (const name of names) if (sourceText.includes(name)) observed.add(name);
      continue;
    }
    const present = [...names].filter((name) => !observed.has(name) && sourceText.includes(name));
    if (present.length === 0) continue;
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      /\.[jt]sx$/iu.test(sourcePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const candidates = new Set(present);
    /** Records every candidate access whose use is not a dereference or an assignment. */
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const name = readAccessedName(node);
        if (name !== undefined && candidates.has(name) && !isDereferenceOrAssignment(node)) {
          observed.add(name);
        }
      }
      if (ts.isBindingElement(node)) {
        const bound = readBindingPropertyName(node);
        if (bound !== undefined && candidates.has(bound)) observed.add(bound);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return observed;
}

/** Reads the member name of `x.name` or `x['name']`. */
function readAccessedName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
}

/** Reports whether an access only feeds a further member read or receives an assignment. */
function isDereferenceOrAssignment(access: ts.Expression): boolean {
  let current: ts.Expression = access;
  while (ts.isNonNullExpression(current.parent)) current = current.parent;
  const parent = current.parent;
  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === current
  ) {
    return true;
  }
  return (
    ts.isBinaryExpression(parent) &&
    parent.left === current &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

/** Reads the source property a binding element destructures (`{ name }` or `{ name: alias }`). */
function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  const property = element.propertyName ?? element.name;
  if (ts.isIdentifier(property) || ts.isStringLiteralLike(property)) return property.text;
  return undefined;
}
