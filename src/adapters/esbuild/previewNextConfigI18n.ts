/**
 * Reads a Next.js project's built-in i18n routing settings from `next.config.*` without running it.
 *
 * The preview replaces `next/router` with a static router, so `useRouter().locale` would always be
 * `undefined`. Pages Router apps that configure `i18n` read the active locale from the router and
 * hand it to their i18n library; the runtime then filled the missing value with a generated object
 * and libraries such as i18next failed. The configuration file is only parsed: an object literal
 * property `i18n` with a string `defaultLocale` (and optional string `locales`) is accepted, and
 * anything computed is ignored, so the router keeps Next's `undefined` locale in that case.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const NEXT_CONFIG_FILE_NAMES = [
  'next.config.js',
  'next.config.mjs',
  'next.config.cjs',
  'next.config.ts',
  'next.config.mts',
] as const;
const MAX_CONFIG_BYTES = 256 * 1024;
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$/u;
const cache = new Map<
  string,
  { readonly mtimeMs: number; readonly value?: PreviewNextI18nConfig }
>();

/** Locale routing settings the static router exposes. */
export interface PreviewNextI18nConfig {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}

/**
 * Finds the first literal `i18n` routing configuration in the project's Next config file.
 *
 * @param projectRoot Directory that holds the Next application's `next.config.*`.
 * @returns The literal configuration, or `undefined` when absent, computed, or unreadable.
 */
export async function readPreviewNextI18nConfig(
  projectRoot: string,
): Promise<PreviewNextI18nConfig | undefined> {
  for (const fileName of NEXT_CONFIG_FILE_NAMES) {
    const configPath = path.join(projectRoot, fileName);
    let mtimeMs: number;
    try {
      const metadata = await stat(configPath);
      if (!metadata.isFile() || metadata.size > MAX_CONFIG_BYTES) continue;
      mtimeMs = metadata.mtimeMs;
    } catch {
      continue;
    }
    const cached = cache.get(configPath);
    if (cached?.mtimeMs === mtimeMs) return cached.value;
    let value: PreviewNextI18nConfig | undefined;
    try {
      value = parsePreviewNextI18nConfig(await readFile(configPath, 'utf8'), fileName);
    } catch {
      value = undefined;
    }
    cache.set(configPath, value === undefined ? { mtimeMs } : { mtimeMs, value });
    return value;
  }
  return undefined;
}

/**
 * Extracts a literal `i18n: { defaultLocale, locales }` object from configuration source text.
 *
 * @param sourceText Configuration file contents.
 * @param fileName Name used to pick the parser's script kind.
 * @returns The configuration, or `undefined` when no literal one exists.
 */
export function parsePreviewNextI18nConfig(
  sourceText: string,
  fileName = 'next.config.js',
): PreviewNextI18nConfig | undefined {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    /\.m?ts$/u.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  let found: PreviewNextI18nConfig | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isPropertyAssignment(node) &&
      readPropertyName(node.name) === 'i18n' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      found = readI18nObject(node.initializer);
      if (found !== undefined) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Reads `defaultLocale` and `locales` from one literal object. */
function readI18nObject(object: ts.ObjectLiteralExpression): PreviewNextI18nConfig | undefined {
  let defaultLocale: string | undefined;
  let locales: string[] = [];
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = readPropertyName(property.name);
    if (name === 'defaultLocale' && ts.isStringLiteralLike(property.initializer)) {
      defaultLocale = property.initializer.text;
    } else if (name === 'locales' && ts.isArrayLiteralExpression(property.initializer)) {
      locales = property.initializer.elements
        .filter((element): element is ts.StringLiteralLike => ts.isStringLiteralLike(element))
        .map((element) => element.text);
    }
  }
  if (defaultLocale === undefined || !LOCALE_PATTERN.test(defaultLocale)) return undefined;
  const validLocales = locales.filter((locale) => LOCALE_PATTERN.test(locale));
  return {
    defaultLocale,
    locales: validLocales.includes(defaultLocale) ? validLocales : [defaultLocale, ...validLocales],
  };
}

/** Returns a static property name. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}
