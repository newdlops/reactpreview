/** Verifies the scan-friendly page context and live composition Output summaries. */
import { describe, expect, it } from 'vitest';
import type { PreviewRuntimeHealthEvent } from '../../src/presentation/previewRuntimeHealthProtocol';
import { formatPreviewRuntimeHealthSummary } from '../../src/presentation/previewRuntimeHealthSummary';

/** Supplies stable transport metadata while each test owns its diagnostic detail. */
function createEvent(
  event: PreviewRuntimeHealthEvent['event'],
  detail: PreviewRuntimeHealthEvent['detail'],
): PreviewRuntimeHealthEvent {
  return {
    category: 'page-composition',
    detail,
    event,
    eventId: 'runtime-health-1',
    revision: 1,
    sequence: 1,
    severity: 'info',
    timestamp: '2026-07-23T09:00:00.000Z',
  };
}

describe('Preview runtime health summary', () => {
  /** Explains a partial static choice and shows whether a stronger alternative existed. */
  it('summarizes selected page context and authored application path', () => {
    const summary = formatPreviewRuntimeHealthSummary(
      createEvent('page-context-selected', {
        applicationPath: ['Application', 'CompanyShell', 'DashboardPage', 'TargetPanel'],
        candidateComplete: false,
        candidateCount: 2,
        candidateId: 'partial-target-owner',
        candidateSummaries: [{ complete: false }, { complete: true }],
        pathname: '/company/1/dashboard',
        rootExport: 'TargetPanel',
        rootSourcePath: '/workspace/src/TargetPanel.tsx',
        stopReason: 'private-owner',
      }),
    );

    expect(summary).toContain('Page context · partial context · TargetPanel');
    expect(summary).toContain('alternatives=2 (1 complete)');
    expect(summary).toContain('Application > CompanyShell > DashboardPage > TargetPanel');
  });

  /** Places missing shell identities and blocker-bearing tree rows next to target output state. */
  it('summarizes the observed page tree after commit', () => {
    const summary = formatPreviewRuntimeHealthSummary(
      createEvent('page-composition-snapshot', {
        applicationPath: ['Application', 'DashboardPage', 'TargetPanel'],
        authoredStaticPath: ['Application', 'DashboardPage', 'TargetPanel'],
        blockerSummary: { active: 1, items: [], total: 1 },
        candidate: {
          complete: true,
          rootExport: 'Application',
          stopReason: 'root-reached',
        },
        missingShellNames: ['DashboardPage'],
        observedFiberPath: ['Application', 'FallbackPage'],
        route: { pathname: '/dashboard' },
        statusCounts: { expected: 1, hostOutput: 1, mounted: 2, observed: 4 },
        targetState: {
          exportName: 'TargetPanel',
          stage: 'page-committed-target-absent',
        },
        treeRows: [
          {
            blocker: false,
            currentFile: false,
            depth: 0,
            kind: 'component',
            mounted: true,
            name: 'Application',
            state: 'mounted-output',
          },
          {
            blocker: true,
            currentFile: true,
            depth: 1,
            kind: 'blocker',
            mounted: false,
            name: 'Target data unavailable',
            state: 'blocking',
          },
        ],
        treeRowsTruncated: false,
      }),
    );

    expect(summary).toContain('page-committed-target-absent');
    expect(summary).toContain('Observed Fiber path: Application > FallbackPage');
    expect(summary).toContain('Missing from live tree: DashboardPage');
    expect(summary).toContain('[+] Application · mounted-output');
    expect(summary).toContain('[!] Target data unavailable · blocking · current file');
  });
});
