/** Validates glob and require.context syntax and rejects unsafe regular expressions. */
import { PreviewSourceTransformError } from './previewSourceReplacement';
import type { GlobOptions, RequireContextOptions } from './previewSourceTransformModel';
import { parseStaticObject, parseStaticString } from './staticCallParser';

/** Parses the bounded Vite glob option subset used by the generated object. */
export function parseGlobOptions(
  rawOptions: string | undefined,
  eagerByCallee: boolean,
  sourcePath: string,
): GlobOptions {
  const options = parseStaticObject(rawOptions);
  if (options === undefined) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob options must be a simple object literal without spreads or computed properties.`,
    );
  }
  const supportedOptionNames = new Set(['as', 'eager', 'import', 'query']);
  const unsupportedOptionName = [...options.keys()].find(
    (optionName) => !supportedOptionNames.has(optionName),
  );
  if (unsupportedOptionName !== undefined) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob option ${JSON.stringify(unsupportedOptionName)} is not supported by React Preview.`,
    );
  }
  const rawEager = options.get('eager');
  if (rawEager !== undefined && rawEager !== 'true' && rawEager !== 'false') {
    throw new PreviewSourceTransformError(`${sourcePath}: import.meta.glob eager must be boolean.`);
  }

  const rawImportName = options.get('import');
  let importName = rawImportName === undefined ? undefined : parseStaticString(rawImportName);
  if (rawImportName !== undefined && importName === undefined) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob import must be a string literal.`,
    );
  }

  const hasLegacyAs = options.has('as');
  if (hasLegacyAs && (options.has('query') || options.has('import'))) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob legacy as cannot be combined with query or import.`,
    );
  }
  const rawQuery = options.get('query') ?? options.get('as');
  const parsedQuery = rawQuery === undefined ? undefined : parseStaticString(rawQuery);
  if (rawQuery !== undefined && parsedQuery === undefined) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob query must be a string literal.`,
    );
  }
  if (hasLegacyAs && parsedQuery !== 'raw' && parsedQuery !== 'url') {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob legacy as supports only "raw" or "url".`,
    );
  }
  const query = hasLegacyAs && parsedQuery !== undefined ? `?${parsedQuery}` : parsedQuery;
  if (hasLegacyAs) {
    importName = 'default';
  }

  return {
    eager: eagerByCallee || rawEager === 'true',
    ...(importName === undefined ? {} : { importName }),
    ...(query === undefined ? {} : { query }),
  };
}

/** Parses the static directory, recursion flag, and regular expression of `require.context`. */
export function parseRequireContext(
  arguments_: readonly string[],
  sourcePath: string,
): RequireContextOptions {
  assertArgumentCount(arguments_, 1, 3, 'require.context', sourcePath);
  const directory = parseStaticString(arguments_[0] ?? '');
  if (
    directory === undefined ||
    (!directory.startsWith('./') && !directory.startsWith('../')) ||
    /[*?{}\0]/u.test(directory)
  ) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: require.context directory must be a relative literal without glob metacharacters.`,
    );
  }

  const rawRecursive = arguments_[1] ?? 'true';
  if (rawRecursive !== 'true' && rawRecursive !== 'false') {
    throw new PreviewSourceTransformError(
      `${sourcePath}: require.context recursion must be boolean.`,
    );
  }

  const matcher = parseRegularExpression(arguments_[2] ?? '/^\\.\\//', sourcePath);
  return { directory, matcher, recursive: rawRecursive === 'true' };
}

/**
 * Rejects macro overloads whose additional expressions would be dropped by a compatibility rewrite.
 *
 * @param arguments_ Top-level call arguments preserved as raw source segments.
 * @param minimum Smallest arity supported by the preview compatibility layer.
 * @param maximum Largest arity supported without losing runtime behavior.
 * @param callee User-facing macro name included in the diagnostic.
 * @param sourcePath Source module path included in the diagnostic.
 */
export function assertArgumentCount(
  arguments_: readonly string[],
  minimum: number,
  maximum: number,
  callee: string,
  sourcePath: string,
): void {
  if (arguments_.length < minimum || arguments_.length > maximum) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: ${callee} requires ${
        minimum === maximum
          ? `exactly ${minimum.toString()}`
          : `${minimum.toString()} to ${maximum.toString()}`
      } static arguments in React Preview.`,
    );
  }
}

/** Parses a bounded regular-expression literal without accepting executable constructor syntax. */
export function parseRegularExpression(source: string, sourcePath: string): RegExp {
  const match = /^\/((?:\\.|[^/])*)\/([imu]*)$/u.exec(source.trim());
  if (match === null || (match[1]?.length ?? 0) > 200) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: require.context filter must be a regular-expression literal under 200 characters.`,
    );
  }
  const pattern = match[1] ?? '';
  assertSafeContextRegularExpression(pattern, sourcePath);
  try {
    return new RegExp(pattern, match[2] ?? '');
  } catch {
    throw new PreviewSourceTransformError(
      `${sourcePath}: require.context filter is not a valid regular-expression literal.`,
    );
  }
}

/**
 * Rejects regex features and nested quantifiers that can cause pathological backtracking while
 * filtering thousands of discovered keys. Common extension/alternation filters remain supported.
 */
export function assertSafeContextRegularExpression(pattern: string, sourcePath: string): void {
  if (/\\(?:[1-9]|k<)|\(\?(?!:)/u.test(pattern)) {
    throwUnsafeContextRegularExpression(sourcePath);
  }

  const groups: { containsAlternation: boolean; containsQuantifier: boolean }[] = [];
  let insideCharacterClass = false;
  let quantifierCount = 0;
  let rangedBraceQuantifierCount = 0;
  let unboundedQuantifierCount = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '[') {
      insideCharacterClass = true;
      continue;
    }
    if (character === ']' && insideCharacterClass) {
      insideCharacterClass = false;
      continue;
    }
    if (insideCharacterClass) {
      continue;
    }
    if (character === '(') {
      groups.push({ containsAlternation: false, containsQuantifier: false });
      continue;
    }
    if (character === '|') {
      const group = groups.at(-1);
      if (group !== undefined) {
        group.containsAlternation = true;
      }
      continue;
    }
    if (character === ')') {
      const group = groups.pop();
      const nextCharacter = pattern[index + 1] ?? '';
      const groupIsQuantified = /[*+?{]/u.test(nextCharacter);
      if (
        groupIsQuantified &&
        group !== undefined &&
        (group.containsAlternation || group.containsQuantifier)
      ) {
        throwUnsafeContextRegularExpression(sourcePath);
      }
      if (groupIsQuantified) {
        const parent = groups.at(-1);
        if (parent !== undefined) {
          parent.containsQuantifier = true;
        }
      }
      const parent = groups.at(-1);
      if (parent !== undefined && group !== undefined) {
        parent.containsAlternation ||= group.containsAlternation;
        parent.containsQuantifier ||= group.containsQuantifier;
      }
      continue;
    }
    const isQuestionQuantifier = character === '?' && pattern[index - 1] !== '(';
    const braceQuantifier =
      character === '{' ? /^\{(\d+)(?:,(\d*))?\}/u.exec(pattern.slice(index)) : null;
    const isBraceQuantifier = braceQuantifier !== null;
    const lowerBraceBound = Number(braceQuantifier?.[1] ?? 0);
    const rawUpperBraceBound = braceQuantifier?.[2];
    const upperBraceBound =
      rawUpperBraceBound === undefined || rawUpperBraceBound.length === 0
        ? lowerBraceBound
        : Number(rawUpperBraceBound);
    if (isBraceQuantifier && (lowerBraceBound > 256 || upperBraceBound > 256)) {
      throwUnsafeContextRegularExpression(sourcePath);
    }
    const isRangedBraceQuantifier = rawUpperBraceBound !== undefined;
    rangedBraceQuantifierCount += isRangedBraceQuantifier ? 1 : 0;
    const isUnboundedQuantifier =
      character === '*' || character === '+' || rawUpperBraceBound === '';
    if (isQuestionQuantifier || isBraceQuantifier || isUnboundedQuantifier) {
      quantifierCount += 1;
      unboundedQuantifierCount += isUnboundedQuantifier ? 1 : 0;
      if (quantifierCount > 8 || rangedBraceQuantifierCount > 1 || unboundedQuantifierCount > 1) {
        throwUnsafeContextRegularExpression(sourcePath);
      }
      const group = groups.at(-1);
      if (group !== undefined) {
        group.containsQuantifier = true;
      }
    }
  }
}

/** Raises the shared actionable diagnostic for a potentially pathological context filter. */
export function throwUnsafeContextRegularExpression(sourcePath: string): never {
  throw new PreviewSourceTransformError(
    `${sourcePath}: require.context filter must avoid lookarounds, backreferences, large or repeated range quantifiers, repeated unbounded quantifiers, and nested quantified groups.`,
  );
}
