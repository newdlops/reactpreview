/** Checks browser URL and ownership propagation with an inert coordinator and no network listener. */
import { describe, expect, it, vi } from 'vitest';
import { renderCompiledPreviewHeadlessly } from '../../../src/adapters/node/previewHeadlessRenderer';
import type { PreviewHeadlessOwnershipEvent } from '../../../src/adapters/node/previewHeadlessModel';

const ports = vi.hoisted(() => ({
  listen:
    vi.fn<typeof import('../../../src/adapters/node/previewHeadlessServer').listenOnLoopback>(),
  execute:
    vi.fn<typeof import('../../../src/adapters/node/previewHeadlessCdp').executeChromiumWithCdp>(),
}));

vi.mock('../../../src/adapters/node/previewHeadlessServer', async () => ({
  ...(await vi.importActual<typeof import('../../../src/adapters/node/previewHeadlessServer')>(
    '../../../src/adapters/node/previewHeadlessServer',
  )),
  listenOnLoopback: ports.listen,
}));
vi.mock('../../../src/adapters/node/previewHeadlessCdp', async () => ({
  ...(await vi.importActual<typeof import('../../../src/adapters/node/previewHeadlessCdp')>(
    '../../../src/adapters/node/previewHeadlessCdp',
  )),
  executeChromiumWithCdp: ports.execute,
}));

describe('headless dedicated browser origin', () => {
  it.each(['127.1.0.1', '127.93.164.7'])(
    'navigates and records the actual bound host %s',
    async (host) => {
      ports.listen.mockResolvedValue({ host, port: 43123 });
      ports.execute.mockResolvedValue({
        exitCode: 0,
        exitSignal: null,
        cdpExceptions: [],
        incidentalNetworkFailures: [],
        requiredArtifactFailures: [],
        runtimeEvents: [],
        stderr: '',
        timedOut: false,
      });
      const events: PreviewHeadlessOwnershipEvent[] = [];
      const result = await renderCompiledPreviewHeadlessly(
        {
          chunks: [],
          dependencies: [],
          diagnostics: [],
          watchDirectories: [],
          javascript: new TextEncoder().encode('globalThis.inertPreview = true;'),
        },
        {
          dependencySnapshots: [],
          documentPath: '/virtual/Inert.tsx',
          language: 'tsx',
          sourceText: 'export default function Inert() { return null; }',
          workspaceRoot: '/virtual',
        },
        {
          chromiumPath: 'inert-browser-port',
          reportOwnership: (event) => {
            events.push(event);
          },
        },
      );
      expect(ports.execute.mock.calls[0]?.[1]).toBe(`http://${host}:43123/index.html`);
      const listening = events.find((event) => event.kind === 'server-listening');
      expect(listening).toMatchObject({
        kind: 'server-listening',
        loopbackHost: host,
        loopbackPort: 43123,
      });
      expect(typeof listening?.profileRoot).toBe('string');
      expect(result.cleanup).toEqual({
        browserTerminated: true,
        profileRemoved: true,
        serverClosed: true,
      });
    },
  );
});
