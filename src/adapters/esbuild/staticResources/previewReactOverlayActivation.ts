/**
 * Creates source edits that connect a conditionally mounted overlay to its Inspector switch.
 *
 * A JSX gate such as `enabled && <Dialog {...dialogProps} item={item} />` controls only whether the
 * Dialog component is mounted. Many applications keep the actual visual contract in separate props:
 * `dialogProps.open` can remain false and `item` can remain null even after the mount gate is forced
 * on. This adapter wraps only a directly proven overlay terminal and delegates that second, preview-
 * only activation step to the browser runtime. Ordinary authored renders remain byte-for-byte
 * equivalent because the runtime returns the original React element unless an override reveals it.
 */
import ts from 'typescript';
import type { PreviewReactConditionalReplacement } from './previewReactConditionalReplacements';

const PREVIEW_INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';

/** One condition identity that guards the same direct overlay terminal. */
export interface PreviewReactOverlayActivationCandidate {
  /** Stable compiler-issued condition identity registered by the ordinary condition resolver. */
  readonly conditionId: string;
  /** Direct JSX or React.createElement overlay value reached after the condition succeeds. */
  readonly terminal: ts.Expression;
}

/** Internal group for several `a && b && <Modal />` guards that share one terminal expression. */
interface PreviewReactOverlayActivationGroup {
  readonly conditionIds: string[];
  readonly end: number;
  readonly start: number;
}

/**
 * Inserts balanced wrapper calls around direct overlay terminals.
 *
 * Prefix and suffix edits are zero-width so independently instrumented conditions inside sibling
 * expressions retain their original source ranges. Conditions in one logical-AND chain are grouped,
 * ensuring the terminal is cloned at most once even when several switches guard it.
 */
export function createPreviewReactOverlayActivationReplacements(
  sourceFile: ts.SourceFile,
  candidates: readonly PreviewReactOverlayActivationCandidate[],
): readonly PreviewReactConditionalReplacement[] {
  const groups = new Map<string, PreviewReactOverlayActivationGroup>();
  for (const candidate of candidates) {
    const start = candidate.terminal.getStart(sourceFile);
    const end = candidate.terminal.end;
    const key = `${start.toString()}:${end.toString()}`;
    const current = groups.get(key);
    if (current === undefined) {
      groups.set(key, {
        conditionIds: [candidate.conditionId],
        end,
        start,
      });
      continue;
    }
    if (!current.conditionIds.includes(candidate.conditionId)) {
      current.conditionIds.push(candidate.conditionId);
    }
  }

  const api = `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
  const replacements: PreviewReactConditionalReplacement[] = [];
  for (const group of groups.values()) {
    replacements.push(
      {
        end: group.start,
        replacement: `${api}.resolveOverlayActivationRenderValue(${JSON.stringify(group.conditionIds)}, (`,
        start: group.start,
      },
      {
        end: group.end,
        replacement: '))',
        start: group.end,
      },
    );
  }
  return replacements;
}
