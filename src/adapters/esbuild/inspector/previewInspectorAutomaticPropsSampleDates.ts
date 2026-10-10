/**
 * Places the sample dates of generated automatic props on the preview's current day.
 *
 * Declared-type props (`completePreviewAutomaticProps`) carry the canonical compile-time sample
 * dates so compiled output stays deterministic. Every other generated date reaches the page through
 * the shared sample-date API, so the emitted descriptor's automatic props are rebased the same way
 * once, before the Inspector runtime reads them: SimSheet's typed `weeks.today` showed January 15
 * on an October day. Other strings, including authored literals, pass through unchanged.
 */
import { createPreviewSampleDateApiExpression } from '../previewSampleDateRuntimeSource';

/** Deepest props level visited; typed props are bounded to four levels already. */
const MAX_REBASE_DEPTH = 8;

/**
 * Returns statements that rebase, in place, the automatic props of one emitted descriptor.
 *
 * @param descriptorName Binding of the descriptor object literal, before it is frozen.
 * @returns Module statements to place directly after the descriptor declaration.
 */
export function createPreviewInspectorAutomaticPropsSampleDateStatements(
  descriptorName: string,
): readonly string[] {
  return [
    '{',
    `  const sampleDates = ${createPreviewSampleDateApiExpression()};`,
    '  const rebaseProps = (value, depth) => {',
    `    if (value === null || typeof value !== 'object' || depth > ${String(MAX_REBASE_DEPTH)}) return;`,
    '    for (const [key, child] of Object.entries(value)) {',
    "      if (typeof child === 'string') {",
    '        const rebased = sampleDates.rebase(child);',
    '        if (rebased !== child) value[key] = rebased;',
    '      } else rebaseProps(child, depth + 1);',
    '    }',
    '  };',
    `  const inspector = ${descriptorName}.inspector;`,
    '  rebaseProps(inspector?.targetAutomaticProps, 0);',
    '  for (const candidate of inspector?.pageCandidates ?? []) {',
    '    rebaseProps(candidate?.rootAutomaticProps, 0);',
    '    rebaseProps(candidate?.targetAutomaticProps, 0);',
    '  }',
    '}',
  ];
}
