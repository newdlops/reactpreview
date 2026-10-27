/** Confirms that cleanup probes use the recorded dedicated endpoint and reject incomplete evidence. */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { PreviewTsxCorpusDiagnosticEvent } from '../../../src/adapters/node/previewHeadlessTsxCorpusCampaignTypes';
import { isValidRowOwnershipEvent } from '../../../src/adapters/node/previewTsxCorpusModel';
import { loopbackPortIsClosed } from '../../../src/adapters/node/previewTsxCorpusOwnership';

const connection = vi.hoisted(() => vi.fn());
vi.mock('node:net', async () => ({
  ...(await vi.importActual<typeof import('node:net')>('node:net')),
  createConnection: connection,
}));

describe('dedicated listener cleanup ownership', () => {
  it('checks the recorded host and port and disposes its probe socket', async () => {
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    connection.mockImplementation(() => {
      queueMicrotask(() =>
        socket.emit(
          'error',
          Object.assign(new Error('closed'), {
            code: 'ECONNREFUSED',
          }),
        ),
      );
      return socket;
    });
    expect(await loopbackPortIsClosed(43123, '127.93.164.7')).toBe(true);
    expect(connection).toHaveBeenCalledWith({ host: '127.93.164.7', port: 43123 });
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(socket.listenerCount('error')).toBe(0);
  });

  it.each(['0.0.0.0', '192.168.1.2', 'localhost', '127.1.0.1.evil'])(
    'does not connect when the recorded host is invalid: %s',
    async (host) => {
      expect(await loopbackPortIsClosed(43123, host)).toBe(false);
      expect(connection).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, '0.0.0.0', '192.168.1.2', '127.1.0.1.evil'])(
    'rejects ownership telemetry without an exact safe endpoint: %j',
    (host) => {
      const event = {
        kind: 'row-ownership',
        lane: 1,
        generation: 'owned-test',
        ownership: {
          kind: 'server-listening',
          profileRoot: '/owned/profile',
          loopbackPort: 43123,
          loopbackHost: host,
        },
      } as unknown as PreviewTsxCorpusDiagnosticEvent;
      expect(isValidRowOwnershipEvent(event)).toBe(false);
      expect(
        isValidRowOwnershipEvent({
          ...event,
          ownership: {
            kind: 'server-listening',
            profileRoot: '/owned/profile',
            loopbackPort: 43123,
            loopbackHost: '127.93.164.7',
          },
        } as PreviewTsxCorpusDiagnosticEvent),
      ).toBe(true);
    },
  );
});
