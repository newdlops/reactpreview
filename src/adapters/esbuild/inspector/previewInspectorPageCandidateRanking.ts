/**
 * Ranks and bounds Page Inspector mount candidates independently from graph discovery.
 * Keeping this policy separate lets future frameworks add role signals without coupling them to
 * reverse-import traversal, and preserves a nearby low-dependency fallback beside richer pages.
 */
import path from 'node:path';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorPlan';

/**
 * Orders candidates by authored page role and keeps at most `maximumCount` diverse choices.
 * Equal scores retain graph discovery order so repeated builds produce stable selector ordering.
 */
export function rankPreviewInspectorPageCandidates(
  candidates: readonly PreviewInspectorPageCandidate[],
  maximumCount: number,
): readonly PreviewInspectorPageCandidate[] {
  const ranked = candidates
    .map((candidate, discoveryIndex) => ({ candidate, discoveryIndex }))
    .sort(compareCandidates);
  const selected = ranked.slice(0, maximumCount).map(({ candidate }) => candidate);
  const nearest = ranked.find(({ candidate }) => candidate.rootStepIndex === undefined)?.candidate;
  if (nearest !== undefined && !selected.includes(nearest) && selected.length === maximumCount) {
    selected[selected.length - 1] = nearest;
  }
  return Object.freeze(selected);
}

/** Sorts descending by semantic score and ascending by stable discovery order. */
function compareCandidates(
  left: { readonly candidate: PreviewInspectorPageCandidate; readonly discoveryIndex: number },
  right: { readonly candidate: PreviewInspectorPageCandidate; readonly discoveryIndex: number },
): number {
  const scoreDifference = scoreCandidate(right.candidate) - scoreCandidate(left.candidate);
  return scoreDifference !== 0 ? scoreDifference : left.discoveryIndex - right.discoveryIndex;
}

/** Scores production shell coverage, page roles, and exact direct-ancestry completeness. */
function scoreCandidate(candidate: PreviewInspectorPageCandidate): number {
  const sourceStem = path.basename(candidate.root.sourcePath).replace(/\.[^.]+$/u, '');
  const sourceName = path.basename(candidate.root.sourcePath);
  const renderLabel =
    candidate.rootStepIndex === undefined
      ? ''
      : (candidate.renderPath?.steps[candidate.rootStepIndex]?.label ?? '');
  const identity = `${candidate.root.exportName} ${sourceStem} ${renderLabel}`;
  let score = Math.min(candidate.rootStepIndex ?? 0, 100);
  // Filesystem-proven App Router pages own the actual `children` branch and must outrank a nearby
  // layout export that cannot display any page content when mounted by itself.
  if (candidate.routeLocation?.evidenceKind === 'next-app-filesystem') score += 15_000;
  if (/(?:App(?!lication)|Application|Layout|Shell|Frame)/u.test(identity)) score += 9_000;
  else if (/(?:Page|Screen|View)/u.test(identity)) score += 6_000;
  else if (/(?:Form|Wizard)/u.test(identity)) score += 4_500;
  else if (/Router|Route/u.test(identity)) score += 2_500;
  if (candidate.renderPath?.entryPoint !== undefined && candidate.rootStepIndex !== undefined) {
    // A complete checkpoint is the exported application root immediately below ReactDOM. It owns
    // route layouts, headers, navigation, portals, and global providers that a nearer `*App`
    // module commonly omits, so it must outrank a structurally named but partial inner shell.
    score += candidate.complete ? 12_000 : 750;
  }
  if (candidate.rootStepIndex === undefined && candidate.complete && candidate.edges.length > 0) {
    score += 3_000;
  } else if (candidate.complete) {
    score += 500;
  }
  if (candidate.rootStepIndex === undefined && candidate.edges.length > 0) score += 500;
  /*
   * A re-export-only index checkpoint does not own page JSX. Mounting it commonly activates every
   * lazy sibling in a broad page barrel, while the complete concrete page candidate already exists
   * beside it. Prefer that authored page without penalizing real `index.tsx` components that reverse
   * ancestry proved complete.
   */
  if (
    !candidate.complete &&
    candidate.stopReason === 'render-path-checkpoint' &&
    /^index\.[cm]?[jt]sx?$/iu.test(sourceName)
  ) {
    score -= 8_000;
  }
  // An owned BrowserRouter is useful when static route evidence lets the runtime seed its location
  // before module evaluation. Without such evidence, retain the older conservative penalty.
  if (candidate.rootOwnsRouter && candidate.routeLocation === undefined) score -= 2_500;
  return score;
}
