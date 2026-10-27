/** Scores virtual-page content using authored identity tokens and framework mode. */
import path from 'node:path';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';
import type { PreviewInspectorVirtualPageMode } from './previewInspectorVirtualPageModel';

/** One exact identity spelling; no route, score, resolver result, or candidate is retained. */
interface IdentityTokens {
  /** Most recent complete input, compared again on every use including mutable/getter-backed data. */
  readonly identity: string;
  /** Private lexical role tokens used only for read-only membership checks. */
  readonly tokens: ReadonlySet<string>;
}

const tokensByOwner = new WeakMap<object, IdentityTokens>();
const MAX_RETAINED_IDENTITY_CHARACTERS = 4096;

/** Produces a stable de-duplication key without conflating independent application entries. */
export function createVirtualPageEmissionKey(
  authoredCandidate: PreviewInspectorPageCandidate,
  contentCandidate: PreviewInspectorPageCandidate,
): string {
  return [
    authoredCandidate.renderPath?.id ?? authoredCandidate.id,
    path.normalize(contentCandidate.root.sourcePath),
    contentCandidate.root.exportName,
    authoredCandidate.routeLocation?.componentName ?? '',
    authoredCandidate.routeLocation?.pattern ?? '',
  ].join('\0');
}

/** Scores page roles and dependency safety without using any project-specific identifier. */
export function scoreVirtualPageContent(
  candidate: PreviewInspectorPageCandidate,
  authoredCandidate: PreviewInspectorPageCandidate,
): number {
  const sourceName = path.basename(candidate.root.sourcePath);
  const sourceStem = sourceName.replace(/\.[^.]+$/u, '');
  const stepLabel =
    candidate.rootStepIndex === undefined
      ? ''
      : (candidate.renderPath?.steps[candidate.rootStepIndex]?.label ?? '');
  const tokens = readVirtualPageIdentityTokens(
    candidate,
    `${candidate.root.exportName} ${sourceStem} ${stepLabel}`,
  );
  let score = 0;

  if (hasAnyToken(tokens, ['page', 'screen', 'view'])) score += 20_000;
  else if (hasAnyToken(tokens, ['form', 'wizard'])) score += 14_000;
  else if (hasAnyToken(tokens, ['panel', 'section', 'modal', 'dialog'])) score += 8_000;
  if (hasAnyToken(tokens, ['app', 'application', 'router', 'route'])) score -= 18_000;
  if (hasAnyToken(tokens, ['entry', 'layout', 'shell', 'frame', 'root'])) score -= 12_000;
  if (candidate.stopReason === 'render-path-checkpoint') score += 2_000;
  if (/\.[cm]?[jt]sx$/iu.test(sourceName)) score += 1_500;
  if (/^index\.[cm]?[jt]sx?$/iu.test(sourceName)) score -= 5_000;
  if (candidate.rootStepIndex !== undefined) {
    // Inner-to-outer indices make a smaller checkpoint cheaper once semantic roles tie.
    score -= Math.min(1_000, Math.max(0, candidate.rootStepIndex) * 20);
  }
  if (
    path.normalize(candidate.root.sourcePath) ===
      path.normalize(authoredCandidate.root.sourcePath) &&
    candidate.root.exportName === authoredCandidate.root.exportName
  ) {
    // Keep the authored root when no materially safer page checkpoint exists.
    score += 250;
  }
  return score;
}

/**
 * Reuses only exact lexical name tokens while their owning evidence object is still reachable.
 *
 * @param owner Candidate or visual evidence whose lifetime bounds the single retained identity.
 * @param identity Current complete name string, read before every lookup so edits remain live.
 * @returns Private read-only tokens; oversized inputs are analyzed normally without retention.
 */
export function readVirtualPageIdentityTokens(
  owner: object,
  identity: string,
): ReadonlySet<string> {
  const previous = tokensByOwner.get(owner);
  if (previous?.identity === identity) return previous.tokens;
  const tokens = tokenizeComponentIdentity(identity);
  if (identity.length <= MAX_RETAINED_IDENTITY_CHARACTERS) {
    tokensByOwner.set(owner, { identity, tokens });
  }
  return tokens;
}

/** Splits PascalCase, kebab-case, snake_case, and path-like names into comparable role tokens. */
export function tokenizeComponentIdentity(identity: string): ReadonlySet<string> {
  const separated = identity
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
  return new Set(
    separated
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

/** Returns true when one semantic role token is present as a complete word. */
export function hasAnyToken(tokens: ReadonlySet<string>, expected: readonly string[]): boolean {
  return expected.some((token) => tokens.has(token));
}

/** Identifies framework candidates whose existing loader already generates a VirtualPage recipe. */
export function isFrameworkComposedCandidate(candidate: PreviewInspectorPageCandidate): boolean {
  return (
    candidate.routeLocation?.evidenceKind === 'next-app-filesystem' ||
    candidate.nextPagesShell !== undefined
  );
}

/** Assigns the browser-visible composition strategy. */
export function readVirtualPageMode(
  authoredCandidate: PreviewInspectorPageCandidate,
  contentCandidate: PreviewInspectorPageCandidate,
): PreviewInspectorVirtualPageMode {
  if (contentCandidate.routeLocation?.evidenceKind === 'next-app-filesystem') {
    return 'next-app-filesystem';
  }
  if (contentCandidate.nextPagesShell !== undefined) return 'next-pages-filesystem';
  return contentCandidate === authoredCandidate ? 'authored-root' : 'static-page-checkpoint';
}
