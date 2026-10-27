/** Proves that dedicated loopback binding and advertised endpoints retain the same address. */
import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { listenOnLoopback } from '../../../src/adapters/node/previewHeadlessServer';

/** Supplies only the server methods used during binding; no real socket is opened. */
function createServerFixture(address: ReturnType<Server['address']>): {
  readonly listen: (port: number, host: string, ready: () => void) => void;
  readonly server: Server;
} {
  const listen = vi.fn((_port: number, _host: string, ready: () => void) => {
    ready();
  });
  const server = {
    once: vi.fn(),
    off: vi.fn(),
    listen,
    address: () => address,
  } as unknown as Server;
  return { listen, server };
}

describe('headless dedicated loopback endpoint', () => {
  it('binds the inherited PortManager address and returns the actual bound endpoint', async () => {
    const fixture = createServerFixture({ address: '127.1.0.1', family: 'IPv4', port: 43123 });
    const endpoint = await listenOnLoopback(fixture.server, {
      PORT_MANAGER_ACTUAL_LOOPBACK_HOST: '127.1.0.1',
    });
    expect(fixture.listen).toHaveBeenCalledWith(0, '127.1.0.1', expect.any(Function));
    expect(endpoint).toEqual({ host: '127.1.0.1', port: 43123 });
  });

  it('uses the network loopback when the actual-host variable is absent', async () => {
    const fixture = createServerFixture({ address: '127.93.164.7', family: 'IPv4', port: 43124 });
    const endpoint = await listenOnLoopback(fixture.server, {
      PORT_MANAGER_NETWORK_LOOPBACK_HOST: '127.93.164.7',
    });
    expect(fixture.listen).toHaveBeenCalledWith(0, '127.93.164.7', expect.any(Function));
    expect(endpoint).toEqual({ host: '127.93.164.7', port: 43124 });
  });

  it('retains the normal loopback default outside a managed environment', async () => {
    const fixture = createServerFixture({ address: '127.0.0.1', family: 'IPv4', port: 43125 });
    expect(await listenOnLoopback(fixture.server, {})).toEqual({ host: '127.0.0.1', port: 43125 });
    expect(fixture.listen).toHaveBeenCalledWith(0, '127.0.0.1', expect.any(Function));
  });

  it('rejects an invalid configured address before opening a listener', async () => {
    const fixture = createServerFixture({ address: '127.1.0.1', family: 'IPv4', port: 43126 });
    await expect(
      listenOnLoopback(fixture.server, { PORT_MANAGER_ACTUAL_LOOPBACK_HOST: '0.0.0.0' }),
    ).rejects.toThrow('loopback');
    expect(fixture.listen).not.toHaveBeenCalled();
  });

  it.each(['0.0.0.0', '192.168.1.2', '::1'])(
    'rejects an unexpected non-IPv4-loopback bound address %s',
    async (address) => {
      const fixture = createServerFixture({ address, family: 'IPv4', port: 43127 });
      await expect(
        listenOnLoopback(fixture.server, { PORT_MANAGER_ACTUAL_LOOPBACK_HOST: '127.1.0.1' }),
      ).rejects.toThrow('loopback');
    },
  );
});
