/**
 * Verifies that the compiler worker adds the operating system's certificate store to its thread's
 * default TLS roots without removing Node's own roots, and degrades safely on older runtimes.
 */
import tls from 'node:tls';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  trustPreviewSystemCertificates,
  type PreviewTlsCertificateApi,
} from '../../../src/adapters/node/previewSystemCertificateTrust';

describe('trustPreviewSystemCertificates', () => {
  it('keeps the default roots and adds deduplicated system roots', () => {
    let applied: readonly string[] | undefined;
    const api: PreviewTlsCertificateApi = {
      getCACertificates: (type) => (type === 'system' ? ['system-a', 'bundled-a'] : ['bundled-a']),
      setDefaultCACertificates: (certificates) => {
        applied = certificates;
      },
    };

    expect(trustPreviewSystemCertificates(api)).toEqual({
      status: 'applied',
      systemCertificateCount: 2,
    });
    expect(applied).toEqual(['bundled-a', 'system-a']);
  });

  it('leaves the defaults alone without the API, without system roots, or on failure', () => {
    expect(trustPreviewSystemCertificates({})).toEqual({
      status: 'unsupported',
      systemCertificateCount: 0,
    });
    let changed = false;
    const empty: PreviewTlsCertificateApi = {
      getCACertificates: () => [],
      setDefaultCACertificates: () => {
        changed = true;
      },
    };
    expect(trustPreviewSystemCertificates(empty).status).toBe('unavailable');
    expect(changed).toBe(false);
    expect(
      trustPreviewSystemCertificates({
        getCACertificates: () => {
          throw new Error('keychain unavailable');
        },
        setDefaultCACertificates: () => undefined,
      }).status,
    ).toBe('failed');
  });

  /** The real API is per thread: extending a worker's roots must not touch the main thread. */
  it.runIf(
    typeof (tls as unknown as PreviewTlsCertificateApi).setDefaultCACertificates === 'function',
  )('extends only the calling thread', async () => {
    const before = (tls as unknown as PreviewTlsCertificateApi).getCACertificates?.('default');
    const worker = new Worker(
      `
      const tls = require('node:tls');
      const before = tls.getCACertificates('default').length;
      const system = tls.getCACertificates('system');
      tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...system])]);
      require('node:worker_threads').parentPort.postMessage({
        after: tls.getCACertificates('default').length,
        before,
      });
      `,
      { eval: true },
    );
    const counts = await new Promise<{ readonly after: number; readonly before: number }>(
      (resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
      },
    );
    await worker.terminate();

    expect(counts.after).toBeGreaterThanOrEqual(counts.before);
    expect((tls as unknown as PreviewTlsCertificateApi).getCACertificates?.('default')).toEqual(
      before,
    );
  });
});
