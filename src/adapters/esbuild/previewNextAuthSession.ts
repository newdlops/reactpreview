/**
 * Builds the signed-in sample session that the next-auth bridge returns from `auth()`.
 *
 * Server pages and layouts read the session with a zero-argument `auth()` and redirect anonymous
 * visitors to a login page. A preview never carries the application's auth cookie, so the real
 * call can only report "signed out". The sample takes the project's declared `Session` type,
 * including the ambient `declare module "next-auth"` augmentation that adds fields such as
 * `user.role`, and gives the sample user the most privileged declared role so role gates open.
 * `expires` is today's sample date-time and `user.image` is null (no photo, as next-auth allows).
 */
import { PREVIEW_CANONICAL_SAMPLE_DATE_TIME } from './previewSampleDateRuntimeSource';
import { createPreviewTypedValueExpression } from './typeOracle/previewTypedValueExpression';
import type { PreviewTypedCallValue } from './typeOracle/previewTypeOracle';
import type { PreviewTypedValue } from './typeOracle/previewTypeValueSynthesizer';

/** Package whose default `NextAuth(config)` export creates the `auth()` session reader. */
export const PREVIEW_NEXT_AUTH_SPECIFIER = 'next-auth';

/** Exported type that `auth()` resolves to once augmentations are merged. */
export const PREVIEW_NEXT_AUTH_SESSION_TYPE_NAME = 'Session';

/** Usage paths that keep optional standard user fields in the typed sample. */
export const PREVIEW_NEXT_AUTH_SESSION_PATHS = Object.freeze([
  'expires',
  'user.email',
  'user.id',
  'user.image',
  'user.name',
  'user.role',
]);

const NEXT_AUTH_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']next-auth["']/u;
const NEXT_AUTH_AUGMENTATION_PATTERN = /\bdeclare\s+module\s+["']next-auth["']/u;
const DECLARATION_FILE_PATTERN = /\.d\.[cm]?ts$/iu;
const MAXIMUM_AUGMENTATION_FILES = 8;
const ROLE_PATH_PATTERN = /(?:^|\.)roles?(?:\[\])?$/iu;
/** Declared role names ranked from most to least privileged; unmatched names rank last. */
const ROLE_PRIVILEGE_PATTERNS = [/super/iu, /owner|root/iu, /admin/iu] as const;

/** Fallback when no declared type is available: the standard next-auth user fields. */
const DEFAULT_SESSION: PreviewTypedValue = Object.freeze({
  expires: PREVIEW_CANONICAL_SAMPLE_DATE_TIME,
  user: Object.freeze({
    email: 'preview@example.invalid',
    id: 'preview-id',
    image: null,
    name: 'Name',
  }),
});

/** Bounded inputs for finding project declaration files that augment next-auth. */
export interface PreviewNextAuthAugmentationOptions {
  /** Sources of the current build; one must import next-auth before anything is scanned. */
  readonly frontierSourcePaths: readonly string[];
  /** Cached package source inventory, read only when next-auth is imported. */
  readonly readInventory: () => Promise<readonly string[]>;
  /** Snapshot-aware bounded source reader. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
}

/**
 * Lists project declaration files that augment next-auth, so the type program sees them.
 *
 * @param options Frontier sources, package inventory, and a bounded reader.
 * @returns Absolute `.d.ts` paths; empty when the build does not import next-auth.
 */
export async function collectPreviewNextAuthAugmentationPaths(
  options: PreviewNextAuthAugmentationOptions,
): Promise<readonly string[]> {
  let imported = false;
  for (const sourcePath of options.frontierSourcePaths) {
    if (NEXT_AUTH_IMPORT_PATTERN.test((await options.readSource(sourcePath)) ?? '')) {
      imported = true;
      break;
    }
  }
  if (!imported) return [];
  const augmentationPaths: string[] = [];
  for (const sourcePath of await options.readInventory()) {
    if (!DECLARATION_FILE_PATTERN.test(sourcePath)) continue;
    if (NEXT_AUTH_AUGMENTATION_PATTERN.test((await options.readSource(sourcePath)) ?? '')) {
      augmentationPaths.push(sourcePath);
      if (augmentationPaths.length === MAXIMUM_AUGMENTATION_FILES) break;
    }
  }
  return augmentationPaths;
}

/**
 * Creates the expression that evaluates to one sample session object.
 *
 * @param typed Declared `Session` value, or undefined when no type program answered.
 * @returns Side-effect-free expression; `expires` lands on the current sample day.
 */
export function createPreviewNextAuthSessionExpression(
  typed: PreviewTypedCallValue | undefined,
): string {
  const value = typed?.value;
  if (!isRecord(value) || !isRecord(value.user)) {
    return createPreviewTypedValueExpression(DEFAULT_SESSION);
  }
  // The sample user has no profile photo; a key label would render as a broken image URL.
  let session: PreviewTypedValue = {
    ...value,
    expires: PREVIEW_CANONICAL_SAMPLE_DATE_TIME,
    user: Object.hasOwn(value.user, 'image') ? { ...value.user, image: null } : value.user,
  };
  for (const [literalPath, allowed] of Object.entries(typed?.literals ?? {})) {
    if (!ROLE_PATH_PATTERN.test(literalPath)) continue;
    const role = selectPrivilegedRole(allowed);
    if (role !== undefined) session = replacePathValue(session, literalPath.split('.'), role);
  }
  return createPreviewTypedValueExpression(session);
}

/** Picks the most privileged declared role, or none when no name signals privilege. */
function selectPrivilegedRole(allowed: readonly (boolean | number | string)[]): string | undefined {
  for (const pattern of ROLE_PRIVILEGE_PATTERNS) {
    const role = allowed.find((value) => typeof value === 'string' && pattern.test(value));
    if (typeof role === 'string') return role;
  }
  return undefined;
}

/** Copies a descriptor with one literal path (`user.roles[]` sets every item) replaced. */
function replacePathValue(
  value: PreviewTypedValue,
  segments: readonly string[],
  replacement: string,
): PreviewTypedValue {
  const [segment, ...rest] = segments;
  if (segment === undefined) return replacement;
  const listed = segment.endsWith('[]');
  const key = listed ? segment.slice(0, -2) : segment;
  if (!isRecord(value) || !Object.hasOwn(value, key)) return value;
  const current = value[key] as PreviewTypedValue;
  const next = listed
    ? Array.isArray(current)
      ? (current as readonly PreviewTypedValue[]).map((item) =>
          replacePathValue(item, rest, replacement),
        )
      : current
    : replacePathValue(current, rest, replacement);
  return { ...value, [key]: next };
}

/** Narrows a descriptor to a plain record (not an array). */
function isRecord(value: unknown): value is Readonly<Record<string, PreviewTypedValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
