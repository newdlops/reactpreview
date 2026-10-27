/** Checks inherited dedicated-loopback selection and rejects any wider listening interface. */
import { describe, expect, it } from 'vitest';
import {
  isPreviewLoopbackHost,
  resolvePreviewLoopbackHost,
} from '../../../src/adapters/node/previewLoopback';

describe('preview loopback configuration', () => {
  it('prefers the actual address over the network fallback without changing the input', () => {
    const environment = Object.freeze({
      PORT_MANAGER_ACTUAL_LOOPBACK_HOST: '127.1.0.1',
      PORT_MANAGER_NETWORK_LOOPBACK_HOST: '127.93.164.7',
    });
    expect(resolvePreviewLoopbackHost(environment)).toBe('127.1.0.1');
    expect(environment.PORT_MANAGER_NETWORK_LOOPBACK_HOST).toBe('127.93.164.7');
  });

  it('uses an inherited network address or the unmanaged default', () => {
    expect(resolvePreviewLoopbackHost({ PORT_MANAGER_NETWORK_LOOPBACK_HOST: '127.93.164.7' })).toBe(
      '127.93.164.7',
    );
    expect(resolvePreviewLoopbackHost({})).toBe('127.0.0.1');
  });

  it.each([
    '',
    '0.0.0.0',
    '192.168.1.2',
    'localhost',
    '::1',
    '127.1',
    '127.01.0.1',
    '127.1.0.1:4000',
    'http://127.1.0.1',
    '127.1.0.1.evil',
    '127.256.0.1',
    ' 127.1.0.1',
  ])('rejects explicit invalid configuration %j instead of guessing another address', (host) => {
    expect(() =>
      resolvePreviewLoopbackHost({
        PORT_MANAGER_ACTUAL_LOOPBACK_HOST: host,
        PORT_MANAGER_NETWORK_LOOPBACK_HOST: '127.93.164.7',
      }),
    ).toThrow('IPv4 loopback');
  });

  it.each([undefined, null, 127, {}, '127.1.0.1.evil'])(
    'rejects untrusted ownership host %j',
    (host) => {
      expect(isPreviewLoopbackHost(host)).toBe(false);
    },
  );
});
