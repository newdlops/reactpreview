/**
 * Verifies the browser-facing Page Execution candidate summaries: declared component names are
 * added only for default-exported roots whose name can be proven, and each source is read once.
 */
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageExecutionCandidateSummaries } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionCandidateSummary';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

const LAYOUT = '/workspace/app/layout.tsx';
const PAGE = '/workspace/app/explore/page.tsx';

describe('createPreviewInspectorPageExecutionCandidateSummaries', () => {
  it('adds the declared names of default-exported roots', () => {
    const reads: string[] = [];
    const summaries = createPreviewInspectorPageExecutionCandidateSummaries(
      [
        candidate('authentic', { exportName: 'default', sourcePath: LAYOUT }),
        candidate('target-only', { exportName: 'default', sourcePath: PAGE }),
      ],
      (sourcePath) => {
        reads.push(sourcePath);
        return sourcePath === LAYOUT
          ? 'export default function RootLayout() { return null; }'
          : undefined;
      },
    );

    expect(summaries?.[0]).toMatchObject({
      executionRootComponentName: 'RootLayout',
      executionRootExportName: 'default',
      pageRootComponentName: 'RootLayout',
      pageRootExportName: 'default',
    });
    expect(summaries?.[1]).not.toHaveProperty('executionRootComponentName');
    expect(summaries?.[1]).not.toHaveProperty('pageRootComponentName');
    expect(reads).toEqual([LAYOUT, PAGE]);
  });

  it('keeps named roots and missing candidates unchanged', () => {
    const summaries = createPreviewInspectorPageExecutionCandidateSummaries(
      [candidate('named', { exportName: 'ExplorePage', sourcePath: PAGE })],
      () => 'export function ExplorePage() { return null; }',
    );

    expect(summaries?.[0]).not.toHaveProperty('executionRootComponentName');
    expect(summaries?.[0]).toMatchObject({ executionRootExportName: 'ExplorePage' });
    expect(createPreviewInspectorPageExecutionCandidateSummaries(undefined, () => '')).toBe(
      undefined,
    );
  });
});

/** Builds one candidate whose execution root and browser page root are the same component. */
function candidate(
  id: string,
  root: { readonly exportName: string; readonly sourcePath: string },
): PreviewInspectorPageExecutionCandidate {
  return {
    browserCandidate: { id: 'page', root },
    criticalSurfaces: [{ ...root, id: `${id}-root`, strategy: 'authentic-module-export' }],
    executionRootSurfaceId: `${id}-root`,
    fidelity: 'page-authentic',
    id,
    runtimeTargetSurfaceId: `${id}-root`,
    standaloneTarget: false,
  } as unknown as PreviewInspectorPageExecutionCandidate;
}
