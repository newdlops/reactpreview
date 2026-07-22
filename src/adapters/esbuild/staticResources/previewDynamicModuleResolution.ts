/**
 * Models browser-safe TypeScript/JavaScript module resolution for bounded dynamic templates.
 * Native `import()` does not add source extensions, while project bundlers commonly resolve
 * `./icon` to `./icon.tsx` or `./icon/index.ts`. Static expansion therefore emits finite aliases
 * for only the files already discovered inside the trusted workspace; it never probes at runtime.
 */
import path from 'node:path';
import { PreviewSourceTransformError } from './previewSourceReplacement';
import type { StaticPatternMatch } from './staticPattern';

/** Extensions searched by esbuild's ordinary TypeScript/JavaScript resolver, in stable priority. */
const DYNAMIC_MODULE_EXTENSIONS = Object.freeze([
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mts',
  '.mjs',
  '.cts',
  '.cjs',
  '.json',
]);

/** Filesystem pattern, exact key predicate, and static suffix for one dynamic template import. */
export interface DynamicTemplatePlan {
  /** Broad finite glob used only to enumerate candidates at the template's fixed depth. */
  readonly discoveryPattern: string;
  /** Exact regex over normalized importer-relative keys, with each interpolation kept non-slash. */
  readonly matcher: RegExp;
  /** Static query and/or fragment appended to generated runtime import keys. */
  readonly suffix: string;
}

/**
 * Converts decoded dynamic path segments into a finite broad glob and exact normalized matcher.
 * A NUL sentinel represents expressions internally; NUL cannot occur in a filesystem path.
 */
export function createDynamicTemplatePlan(
  staticSegments: readonly string[],
  sourcePath: string,
): DynamicTemplatePlan {
  const expressionSentinel = '\0';
  if (staticSegments.some((segment) => segment.includes(expressionSentinel))) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: dynamic import templates cannot contain NUL characters.`,
    );
  }

  const combined = staticSegments.join(expressionSentinel);
  const suffixIndex = findSuffixIndex(combined);
  const rawPathPattern = combined.slice(0, suffixIndex);
  const suffix = combined.slice(suffixIndex);
  if (suffix.includes(expressionSentinel)) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: dynamic import query and fragment expressions are not statically discoverable.`,
    );
  }
  if (!rawPathPattern.startsWith('./') && !rawPathPattern.startsWith('../')) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: dynamic import templates must begin with "./" or "../".`,
    );
  }

  const normalizedPath = normalizeRelativeTemplatePath(rawPathPattern);
  let discoveryPattern = '';
  let matcherSource = '^';
  let previousWasExpression = false;
  for (const character of normalizedPath) {
    if (character === expressionSentinel) {
      if (!previousWasExpression) discoveryPattern += '*';
      matcherSource += '[^/]*';
      previousWasExpression = true;
    } else {
      discoveryPattern += /[*?{}]/u.test(character) ? '?' : character;
      matcherSource += escapeRegexFragment(character);
      previousWasExpression = false;
    }
  }
  matcherSource += '$';
  return { discoveryPattern, matcher: new RegExp(matcherSource, 'u'), suffix };
}

/**
 * Returns exact, extension-appended, and directory-index patterns for one authored template.
 * All alternatives share the static walk budget and are narrowed again by the plan matcher.
 */
export function createDynamicTemplateDiscoveryPatterns(
  plan: DynamicTemplatePlan,
): readonly string[] {
  return Object.freeze([
    plan.discoveryPattern,
    ...DYNAMIC_MODULE_EXTENSIONS.map((extension) => plan.discoveryPattern + extension),
    ...DYNAMIC_MODULE_EXTENSIONS.map(
      (extension) => `${plan.discoveryPattern.replace(/\/$/u, '')}/index${extension}`,
    ),
  ]);
}

/** Accepts a discovered file when its exact or resolver-compatible extensionless key matches. */
export function matchesDynamicTemplateCandidate(
  plan: DynamicTemplatePlan,
  relativeKey: string,
): boolean {
  return createRuntimeAliases(relativeKey).some((alias) => plan.matcher.test(alias));
}

/**
 * Creates de-duplicated object-literal properties mapping authored runtime keys to exact imports.
 * When `.ts` and `.tsx` siblings compete for one extensionless key, resolver priority is stable.
 */
export function createDynamicTemplateLoaderProperties(
  plan: DynamicTemplatePlan,
  matches: readonly StaticPatternMatch[],
  asynchronous: boolean,
): readonly string[] {
  const properties = new Map<string, string>();
  const orderedMatches = [...matches].sort(compareModuleResolutionPriority);
  for (const match of orderedMatches) {
    const exactImport = `${match.specifier}${plan.suffix}`;
    for (const alias of createRuntimeAliases(match.key)) {
      if (!plan.matcher.test(alias)) continue;
      const runtimeKey = `${alias}${plan.suffix}`;
      const loader = asynchronous
        ? `() => import(${JSON.stringify(exactImport)})`
        : `() => require(${JSON.stringify(exactImport)})`;
      if (!properties.has(runtimeKey)) {
        properties.set(runtimeKey, `${JSON.stringify(runtimeKey)}: ${loader}`);
      }
    }
  }
  return Object.freeze([...properties.values()]);
}

/** Produces exact, extensionless-file, and extensionless-index aliases for one real source file. */
function createRuntimeAliases(relativeKey: string): readonly string[] {
  const aliases = new Set([relativeKey]);
  const extension = DYNAMIC_MODULE_EXTENSIONS.find((item) => relativeKey.endsWith(item));
  if (extension === undefined) return Object.freeze([...aliases]);
  const extensionless = relativeKey.slice(0, -extension.length);
  aliases.add(extensionless);
  if (extensionless.endsWith('/index')) {
    aliases.add(extensionless.slice(0, -'/index'.length) || '.');
  }
  return Object.freeze([...aliases]);
}

/** Mirrors ordinary resolver extension priority before deterministic lexical tie breaking. */
function compareModuleResolutionPriority(
  left: StaticPatternMatch,
  right: StaticPatternMatch,
): number {
  return (
    extensionPriority(left.key) - extensionPriority(right.key) || left.key.localeCompare(right.key)
  );
}

/** Returns the stable extension rank, leaving extensionless exact files ahead of unknown types. */
function extensionPriority(sourcePath: string): number {
  const index = DYNAMIC_MODULE_EXTENSIONS.findIndex((extension) => sourcePath.endsWith(extension));
  return index < 0 ? -1 : index;
}

/** Finds the first static query or fragment boundary without treating template sentinels as text. */
function findSuffixIndex(pattern: string): number {
  return [pattern.indexOf('?'), pattern.indexOf('#')]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), pattern.length);
}

/** Normalizes dot segments while restoring the explicit relative prefix required by expansion. */
function normalizeRelativeTemplatePath(pattern: string): string {
  const normalized = path.posix.normalize(pattern.replaceAll('\\', '/'));
  return normalized.startsWith('../') || normalized === '..'
    ? normalized
    : normalized.startsWith('./')
      ? normalized
      : `./${normalized}`;
}

/** Escapes one literal character for the exact dynamic-template key matcher. */
function escapeRegexFragment(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/gu, '\\$&');
}
