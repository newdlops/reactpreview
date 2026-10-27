/**
 * Recovers effective page-map bindings in authored object-construction order.
 * Opaque spreads and computed keys invalidate earlier references, while later literal properties
 * can prove their own final value. Getter-bearing objects remain diagnostic labels only. Nothing
 * here imports a project module, evaluates a key, or invokes an accessor/factory implementation.
 */
import ts from 'typescript';
import type { PreviewInspectorRouteFactoryChoiceEvidence } from './previewInspectorRouteFactory';

/** Inputs reuse the factory reader's existing lexical and wrapper-composition proofs. */
export interface PreviewInspectorRouteFactoryPageChoiceOptions {
  /** Page-map argument, absent while a factory call is being edited. */
  readonly expression: ts.Expression | undefined;
  /** Parsed authored module used only for stable source offsets. */
  readonly sourceFile: ts.SourceFile;
  /** Const aggregates whose mutations/escapes prevent an exact current binding proof. */
  readonly unstableAggregates: ReadonlySet<string>;
  /** Existing same-file, prior-declaration guard; never evaluates the returned initializer. */
  readonly readInitializer: (identifier: ts.Identifier) => ts.Expression | undefined;
  /** Existing inert JSX/HOC composition proof for non-identifier page property values. */
  readonly readComposition: (
    expression: ts.Expression,
    componentName: string | undefined,
  ) => { readonly localName: string; readonly wrapperLocalNames: readonly string[] } | undefined;
}

/** One cached object value; opaque keys can overwrite any earlier key when this value is spread. */
interface PageChoices {
  /** Effective known labels in first-insertion order, carrying only proven final bindings. */
  readonly choices: readonly PreviewInspectorRouteFactoryChoiceEvidence[];
  /** Whether a spread can contain keys that syntax could not enumerate safely. */
  readonly opaque: boolean;
}

const MAXIMUM_PAGE_CHOICES = 4_096;

/**
 * Collects effective page properties without executing authored values or following imports.
 *
 * Repeated aliases/spreads reuse immutable syntax summaries instead of suppressing a later write
 * or expanding a shared spread graph exponentially. Each summary bounds retained labels; a later
 * write to an already-retained key is still applied after the defensive label ceiling is reached.
 * Cyclic, unresolved, and executable aggregates contribute an opaque spread boundary.
 */
export function collectPreviewInspectorRouteFactoryPageChoices(
  options: PreviewInspectorRouteFactoryPageChoiceOptions,
): PageChoices {
  const cache = new Map<ts.Expression, PageChoices>();
  const active = new Set<ts.Expression>();

  /** Summarizes one literal/const value; caches are local to this exact factory analysis. */
  const read = (expression: ts.Expression | undefined): PageChoices => {
    if (expression === undefined) return freeze([], true);
    const value = unwrap(expression);
    const cached = cache.get(value);
    if (cached !== undefined) return cached;
    if (active.has(value)) return freeze([], true);
    active.add(value);
    let result: PageChoices;
    if (ts.isIdentifier(value)) {
      const initializer = options.readInitializer(value);
      const source = initializer === undefined ? freeze([], true) : read(initializer);
      result = options.unstableAggregates.has(value.text)
        ? freeze(source.choices.map(unresolved), true)
        : source;
    } else if (ts.isObjectLiteralExpression(value)) {
      result = readObject(value);
    } else {
      result = freeze([], true);
    }
    active.delete(value);
    cache.set(value, result);
    return result;
  };

  /** Applies object writes in order, preserving insertion order while replacing their values. */
  const readObject = (object: ts.ObjectLiteralExpression): PageChoices => {
    const choices: PreviewInspectorRouteFactoryChoiceEvidence[] = [];
    const positions = new Map<string, number>();
    let opaque = false;
    let accessor = false;
    const invalidate = (): void => {
      for (let index = 0; index < choices.length; index += 1) {
        const choice = choices[index];
        if (choice !== undefined) choices[index] = unresolved(choice);
      }
      opaque = true;
    };
    const add = (choice: PreviewInspectorRouteFactoryChoiceEvidence): void => {
      const index = positions.get(choice.componentName);
      if (index !== undefined) choices[index] = choice;
      else if (choices.length < MAXIMUM_PAGE_CHOICES) {
        positions.set(choice.componentName, choices.length);
        choices.push(choice);
      }
    };
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = read(property.expression);
        if (spread.opaque) invalidate();
        for (const choice of spread.choices) add(choice);
        continue;
      }
      if (ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) {
        accessor = true;
        continue;
      }
      const componentName = readName(property.name);
      if (componentName === undefined) {
        invalidate();
        continue;
      }
      if (!/^[$_\p{Lu}][$_\u200C\u200D\p{ID_Continue}]*$/u.test(componentName)) continue;
      const value = ts.isShorthandPropertyAssignment(property)
        ? property.name
        : ts.isPropertyAssignment(property)
          ? unwrap(property.initializer)
          : undefined;
      const composition =
        value === undefined || ts.isIdentifier(value)
          ? undefined
          : options.readComposition(value, componentName);
      const localName =
        value !== undefined && ts.isIdentifier(value) ? value.text : composition?.localName;
      add(
        Object.freeze({
          componentName,
          kind: 'page',
          occurrenceStart: property.getStart(options.sourceFile),
          ...(localName === undefined ? {} : { localName }),
          ...(composition?.wrapperLocalNames.length
            ? { wrapperLocalNames: Object.freeze([...composition.wrapperLocalNames]) }
            : {}),
        }),
      );
    }
    if (accessor) invalidate();
    return freeze(choices, opaque);
  };

  return read(options.expression);
}

/** Retains an authored label/offset while removing the unproven executable component reference. */
function unresolved(
  choice: PreviewInspectorRouteFactoryChoiceEvidence,
): PreviewInspectorRouteFactoryChoiceEvidence {
  return Object.freeze({
    componentName: choice.componentName,
    kind: choice.kind,
    occurrenceStart: choice.occurrenceStart,
  });
}

/** Freezes one reusable syntax summary; no runtime object is read or copied here. */
function freeze(
  choices: readonly PreviewInspectorRouteFactoryChoiceEvidence[],
  opaque: boolean,
): PageChoices {
  return Object.freeze({ choices: Object.freeze([...choices]), opaque });
}

/** Accepts only directly spelled identifier/string keys; computed names remain opaque. */
function readName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

/** Removes only type/parenthesis wrappers that preserve the authored aggregate value. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
}
