/** Resolves existing host routing configuration without installing or changing network policy. */
import { isIPv4 } from 'node:net';

/** Actual listener coordinates retained for browser navigation and cleanup verification. */
export interface PreviewLoopbackEndpoint {
  /** Canonical IPv4 literal confined to the loopback address range. */
  readonly host: string;
  /** Actual ephemeral TCP port reported by the bound listener. */
  readonly port: number;
}

/** Rejects hostnames, wildcard interfaces and non-loopback addresses without DNS resolution. */
export function isPreviewLoopbackHost(value: unknown): value is string {
  return typeof value === 'string' && isIPv4(value) && value.startsWith('127.');
}

/**
 * Reads PortManager's inherited actual/network address, preserving the ordinary unmanaged default.
 * Invalid explicit configuration throws before binding; input values and global policy are unchanged.
 */
export function resolvePreviewLoopbackHost(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): string {
  const host =
    environment.PORT_MANAGER_ACTUAL_LOOPBACK_HOST ??
    environment.PORT_MANAGER_NETWORK_LOOPBACK_HOST ??
    '127.0.0.1';
  if (!isPreviewLoopbackHost(host)) {
    throw new Error('Preview listener configuration must specify an IPv4 loopback address.');
  }
  return host;
}
