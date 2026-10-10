/**
 * Lets the compiler worker's package downloads trust the operating system's certificate store.
 *
 * Managed dependency acquisition runs inside the compiler worker thread with Node's global
 * `fetch`. VS Code applies its `http.systemCertificates` setting only to modules of the extension
 * host's main thread, so a worker thread verifies TLS against Node's bundled roots alone. Behind a
 * TLS-inspecting proxy or an organization root installed in the OS store, every registry download
 * then fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, and missing packages silently degrade to
 * neutral contracts. Node 22.19+/24.5+ can extend the current thread's default CA list, so the
 * worker adds the system certificates to the bundled ones before its first request.
 */
import tls from 'node:tls';

/** Outcome of extending one thread's default certificate authorities. */
export interface PreviewSystemCertificateTrustResult {
  /** `applied` added system roots; the other states leave Node's defaults untouched. */
  readonly status: 'applied' | 'failed' | 'unavailable' | 'unsupported';
  /** Number of system certificates found (0 unless applied). */
  readonly systemCertificateCount: number;
}

/** The two `node:tls` functions this module needs; injectable for tests. */
export interface PreviewTlsCertificateApi {
  readonly getCACertificates?: (type?: 'bundled' | 'default' | 'extra' | 'system') => string[];
  readonly setDefaultCACertificates?: (certificates: readonly string[]) => void;
}

/**
 * Adds the operating system's trusted roots to the current thread's default TLS roots. Existing
 * defaults (bundled roots and `NODE_EXTRA_CA_CERTS`) stay trusted; nothing is removed.
 */
export function trustPreviewSystemCertificates(
  api: PreviewTlsCertificateApi = tls as unknown as PreviewTlsCertificateApi,
): PreviewSystemCertificateTrustResult {
  if (
    typeof api.getCACertificates !== 'function' ||
    typeof api.setDefaultCACertificates !== 'function'
  ) {
    return { status: 'unsupported', systemCertificateCount: 0 };
  }
  try {
    const systemCertificates = api.getCACertificates('system');
    if (!Array.isArray(systemCertificates) || systemCertificates.length === 0) {
      return { status: 'unavailable', systemCertificateCount: 0 };
    }
    const defaultCertificates = api.getCACertificates('default');
    api.setDefaultCACertificates([...new Set([...defaultCertificates, ...systemCertificates])]);
    return { status: 'applied', systemCertificateCount: systemCertificates.length };
  } catch {
    return { status: 'failed', systemCertificateCount: 0 };
  }
}
