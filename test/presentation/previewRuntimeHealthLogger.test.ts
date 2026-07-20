/** Verifies ordered live renderer-health records in the shared React Preview Output channel. */
import { describe, expect, it, vi } from 'vitest';
import { handlePreviewRuntimeHealthMessage } from '../../src/presentation/previewRuntimeHealthLogger';

describe('Preview runtime health logger', () => {
  /** Writes a valid event under a distinct grep marker and versioned structured format. */
  it('logs one validated runtime health record', async () => {
    const log = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };

    expect(
      handlePreviewRuntimeHealthMessage(createHealthMessage(), {
        enabled: true,
        log,
        targetPath: '/workspace/CreditPage.tsx',
      }),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(log.warn).toHaveBeenCalledTimes(1);
    });
    const output = String(log.warn.mock.calls[0]?.[0]);
    expect(output).toContain('React preview runtime health');
    expect(output).toContain('"format": "react-preview-runtime-health/v1"');
    expect(output).toContain('"event": "theme-token-repaired"');
    expect(output).toContain('"previewTarget": "/workspace/CreditPage.tsx"');
    expect(output).toContain('"runtimeSessionId": "rp-0123456789abcdef01234567"');
    expect(output).toContain('"runtimeRevision": 2');
  });

  /** Consumes malformed claimed messages before another host protocol can interpret them. */
  it('rejects malformed claimed health messages', () => {
    const log = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    expect(
      handlePreviewRuntimeHealthMessage(
        { type: 'react-preview-runtime-health' },
        { enabled: true, log, targetPath: '/workspace/CreditPage.tsx' },
      ),
    ).toBe(true);
    expect(log.debug).toHaveBeenCalledWith(
      'Ignored a malformed React Preview runtime health event.',
    );
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});

/** Creates one complete non-callable theme repair event. */
function createHealthMessage(): Record<string, unknown> {
  return {
    artifactId: '0123456789abcdef',
    event: {
      category: 'theme',
      detail: { path: ['flex', 'rowBetween'], resolution: 'exact-root-theme' },
      event: 'theme-token-repaired',
      eventId: 'runtime-health-1',
      revision: 2,
      sequence: 1,
      severity: 'warn',
      source: { line: 4, sourcePath: '/workspace/PageHeader.tsx' },
      timestamp: '2026-07-19T13:00:00.000Z',
    },
    runtimeRevision: 2,
    runtimeSessionId: 'rp-0123456789abcdef01234567',
    type: 'react-preview-runtime-health',
  };
}
