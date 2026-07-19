/**
 * Discovers inert HTML shell attributes that application CSS expects before React mounts.
 * The preview never executes the document's scripts or copies arbitrary markup; it preserves only
 * static html/body/mount attributes used by selectors, typography, direction, and layout resets.
 */
import path from 'node:path';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';

const MAX_DOCUMENT_SHELL_BYTES = 512 * 1024;
const DOCUMENT_CANDIDATES = ['index.html', 'public/index.html', 'src/index.html'] as const;
const PRESERVED_ATTRIBUTE_PATTERN = /^(?:class|dir|id|lang|style|data-[\w:.-]+)$/iu;
const ROOT_ELEMENT_PATTERN = /^(?:div|main|section)$/iu;
const PREFERRED_ROOT_IDS = new Set(['root', 'app', 'application', '__next', '__nuxt']);

/** One static DOM attribute copied through `setAttribute`, never interpolated into HTML. */
export interface PreviewDocumentShellAttribute {
  readonly name: string;
  readonly value: string;
}

/** Selector-relevant attributes from the project's authored HTML application shell. */
export interface PreviewDocumentShell {
  readonly bodyAttributes: readonly PreviewDocumentShellAttribute[];
  readonly htmlAttributes: readonly PreviewDocumentShellAttribute[];
  readonly rootAttributes: readonly PreviewDocumentShellAttribute[];
}

/** Discovery result carrying the exact HTML dependency used for future refresh routing. */
export interface PreviewDocumentShellEvidence {
  readonly dependencyPath: string;
  readonly shell: PreviewDocumentShell;
}

/** Cached, byte-bounded source reader supplied by the compiler's project analysis boundary. */
export type ReadPreviewDocumentShellSource = (
  sourcePath: string,
  maximumBytes: number,
) => Promise<string | undefined>;

/** Inputs that keep HTML discovery inside the selected trusted workspace and nearest package. */
export interface DiscoverPreviewDocumentShellOptions {
  readonly projectRoot: string;
  readonly readSource: ReadPreviewDocumentShellSource;
  readonly workspaceRoot: string;
}

/**
 * Selects the first conventional static HTML document containing useful shell attributes.
 * Candidate paths are canonicalized before reading so a symlink cannot broaden the workspace
 * boundary. Empty shells are ignored and framework-generated documents remain untouched.
 *
 * @param options Trusted roots and cached inert source reader.
 * @returns Static shell evidence, or `undefined` when the app has no authored HTML document.
 */
export async function discoverPreviewDocumentShell(
  options: DiscoverPreviewDocumentShellOptions,
): Promise<PreviewDocumentShellEvidence | undefined> {
  for (const relativePath of DOCUMENT_CANDIDATES) {
    const candidatePath = path.resolve(options.projectRoot, relativePath);
    const canonicalPath = canonicalizeExistingPath(candidatePath);
    if (!isPathInside(options.workspaceRoot, canonicalPath)) continue;
    const sourceText = await options.readSource(canonicalPath, MAX_DOCUMENT_SHELL_BYTES);
    if (sourceText === undefined) continue;
    const shell = parsePreviewDocumentShell(sourceText);
    if (shell !== undefined) return { dependencyPath: canonicalPath, shell };
  }
  return undefined;
}

/**
 * Parses only opening tags and static attribute syntax from one bounded HTML string.
 * Quoted `>` characters are handled by the tag scanner; malformed or template-owned attributes
 * are skipped individually without discarding other exact selector evidence.
 *
 * @param sourceText Authored HTML document read without execution.
 * @returns Immutable shell attributes when at least one useful value was found.
 */
export function parsePreviewDocumentShell(sourceText: string): PreviewDocumentShell | undefined {
  const htmlTag = findOpeningTag(sourceText, 'html');
  const bodyTag = findOpeningTag(sourceText, 'body');
  const rootTag = bodyTag === undefined ? undefined : findMountRootTag(sourceText, bodyTag.end);
  const shell: PreviewDocumentShell = Object.freeze({
    bodyAttributes: Object.freeze(parsePreservedAttributes(bodyTag?.text ?? '', false)),
    htmlAttributes: Object.freeze(parsePreservedAttributes(htmlTag?.text ?? '', false)),
    rootAttributes: Object.freeze(parsePreservedAttributes(rootTag?.text ?? '', true)),
  });
  return shell.bodyAttributes.length + shell.htmlAttributes.length + shell.rootAttributes.length > 0
    ? shell
    : undefined;
}

/** Complete opening-tag text plus the first source offset after its closing angle bracket. */
interface PreviewOpeningTag {
  readonly end: number;
  readonly name: string;
  readonly text: string;
}

/** Finds one named opening tag and scans through quoted attribute values safely. */
function findOpeningTag(sourceText: string, tagName: string): PreviewOpeningTag | undefined {
  const pattern = new RegExp(`<${tagName}(?=[\\s>])`, 'iu');
  const match = pattern.exec(sourceText);
  return match?.index === undefined ? undefined : scanOpeningTag(sourceText, match.index);
}

/** Scans one opening tag without treating a quoted `>` as the tag terminator. */
function scanOpeningTag(sourceText: string, start: number): PreviewOpeningTag | undefined {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== '>') continue;
    const text = sourceText.slice(start, index + 1);
    const name = /^<([\w:-]+)/u.exec(text)?.[1];
    return name === undefined ? undefined : { end: index + 1, name, text };
  }
  return undefined;
}

/** Selects a conventional mount element, preferring framework root identifiers over other IDs. */
function findMountRootTag(sourceText: string, bodyStart: number): PreviewOpeningTag | undefined {
  const candidates: PreviewOpeningTag[] = [];
  const pattern = /<(?:div|main|section)(?=[\s>])/giu;
  pattern.lastIndex = bodyStart;
  for (const match of sourceText.matchAll(pattern)) {
    if (match.index < bodyStart) continue;
    const tag = scanOpeningTag(sourceText, match.index);
    if (tag === undefined || !ROOT_ELEMENT_PATTERN.test(tag.name)) continue;
    const attributes = parsePreservedAttributes(tag.text, true);
    if (!attributes.some((attribute) => attribute.name === 'id')) continue;
    candidates.push(tag);
    const id = attributes.find((attribute) => attribute.name === 'id')?.value;
    if (id !== undefined && PREFERRED_ROOT_IDS.has(id.toLowerCase())) return tag;
    if (candidates.length >= 32) break;
  }
  return candidates[0];
}

/** Extracts a safe attribute allowlist while optionally retaining the mount element's static ID. */
function parsePreservedAttributes(
  openingTag: string,
  preserveId: boolean,
): PreviewDocumentShellAttribute[] {
  const body = openingTag.replace(/^<[\w:-]+/u, '').replace(/\/?\s*>$/u, '');
  const attributes: PreviewDocumentShellAttribute[] = [];
  const pattern = /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu;
  for (const match of body.matchAll(pattern)) {
    const rawName = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    if (rawName === undefined || value === undefined) continue;
    const name = rawName.toLowerCase();
    if (!PRESERVED_ATTRIBUTE_PATTERN.test(name) || (name === 'id' && !preserveId)) continue;
    attributes.push(Object.freeze({ name, value }));
  }
  return attributes;
}

/** Checks canonical containment without accepting sibling paths sharing the same prefix. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
