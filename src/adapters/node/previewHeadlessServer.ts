/** Serves immutable preview artifacts and confined public assets on loopback. */
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import path from 'node:path';
import { boundedJson } from './previewHeadlessEvidence';
import { retainEvidence, retainPriorityLoopbackEvidence } from './previewHeadlessLifecycle';
import {
  isPreviewLoopbackHost,
  resolvePreviewLoopbackHost,
  type PreviewLoopbackEndpoint,
} from './previewLoopback';
import {
  HEADLESS_PUBLIC_ASSET_PREFIX,
  MAX_HEADLESS_PUBLIC_ASSET_BYTES,
} from './previewHeadlessModel';

/** Returns a content type for planner-validated browser artifact paths. */
export function mimeTypeForPreviewArtifact(relativePath: string): string {
  if (relativePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (relativePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

export interface PreviewHeadlessNetworkFailure {
  readonly required: boolean;
  readonly text: string;
}

/** Separates failed planned artifacts from browser-discovered incidental resources. */
export function classifyPreviewHeadlessNetworkFailure(
  value: unknown,
  documentUrl: string,
  plannedRoutePaths: ReadonlySet<string>,
): PreviewHeadlessNetworkFailure | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  if (entry.source !== 'network' || entry.level !== 'error') return undefined;
  const text = (typeof entry.text === 'string' ? entry.text : boundedJson(entry)).slice(0, 8_192);
  const discoveredUrl = /https?:\/\/[^\s"'<>]+/u.exec(text)?.[0];
  const urlValue = typeof entry.url === 'string' ? entry.url : discoveredUrl;
  if (urlValue === undefined) return { required: false, text };
  try {
    const failedUrl = new URL(urlValue);
    const previewOrigin = new URL(documentUrl).origin;
    return {
      required: failedUrl.origin === previewOrigin && plannedRoutePaths.has(failedUrl.pathname),
      text,
    };
  } catch {
    return { required: false, text };
  }
}

/** Creates an HTTP server exposing exact planned routes and bounded request evidence. */
export function createPreviewHeadlessServer(
  routes: ReadonlyMap<string, { readonly contents: Uint8Array; readonly type: string }>,
  requests: string[],
  publicAssetRoot?: string,
): Server {
  return createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      retainEvidence(requests, `${request.method ?? 'UNKNOWN'} 405`);
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      retainEvidence(requests, 'MALFORMED 400');
      response.writeHead(400).end();
      return;
    }
    const exactRoute = routes.get(pathname);
    if (
      exactRoute === undefined &&
      publicAssetRoot !== undefined &&
      pathname.startsWith(HEADLESS_PUBLIC_ASSET_PREFIX)
    ) {
      void readPreviewHeadlessPublicAsset(publicAssetRoot, pathname).then((publicAsset) => {
        retainEvidence(requests, `${pathname} ${publicAsset === undefined ? '404' : '200-public'}`);
        if (publicAsset === undefined) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Length': publicAsset.contents.byteLength,
          'Content-Type': publicAsset.type,
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : publicAsset.contents);
      });
      return;
    }
    if (
      exactRoute === undefined &&
      isPreviewHeadlessGuardedClientRouteNavigation(request, pathname)
    ) {
      retainPriorityLoopbackEvidence(requests, `${pathname} 204-navigation-blocked`);
      response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const route = exactRoute;
    retainEvidence(requests, `${pathname} ${route === undefined ? '404' : '200'}`);
    if (route === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': route.contents.byteLength,
      'Content-Type': route.type,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : route.contents);
  });
}

/** Reads one bounded public asset while rejecting traversal and escaping symlinks. */
export async function readPreviewHeadlessPublicAsset(
  publicAssetRoot: string,
  pathname: string,
): Promise<{ readonly contents: Uint8Array; readonly type: string } | undefined> {
  try {
    const encodedRelativePath = pathname.slice(HEADLESS_PUBLIC_ASSET_PREFIX.length);
    const relativePath = decodeURIComponent(encodedRelativePath);
    if (relativePath.length === 0 || /[\\\0]/u.test(relativePath)) return undefined;
    const canonicalRoot = await realpath(publicAssetRoot);
    const candidatePath = path.resolve(canonicalRoot, relativePath);
    if (!isPathInside(canonicalRoot, candidatePath)) return undefined;
    const canonicalCandidate = await realpath(candidatePath);
    if (!isPathInside(canonicalRoot, canonicalCandidate)) return undefined;
    const metadata = await stat(canonicalCandidate);
    if (!metadata.isFile() || metadata.size > MAX_HEADLESS_PUBLIC_ASSET_BYTES) return undefined;
    return {
      contents: await readFile(canonicalCandidate),
      type: mimeTypeForPreviewPublicAsset(canonicalCandidate),
    };
  } catch {
    return undefined;
  }
}

/** Returns a nosniff-compatible content type for passive files served only by headless QA. */
export function mimeTypeForPreviewPublicAsset(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.avif':
      return 'image/avif';
    case '.bmp':
      return 'image/bmp';
    case '.gif':
      return 'image/gif';
    case '.ico':
      return 'image/x-icon';
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.mp4':
      return 'video/mp4';
    case '.ogg':
      return 'audio/ogg';
    case '.webm':
      return 'video/webm';
    default:
      return 'application/octet-stream';
  }
}

/** Reports whether one resolved file remains at or below its canonical public directory. */
export function isPathInside(directoryPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

/** Recognizes bounded full-document client-route navigations guarded from replacing the preview. */
export function isPreviewHeadlessGuardedClientRouteNavigation(
  request: IncomingMessage,
  pathname: string,
): boolean {
  if (
    (request.method !== 'GET' && request.method !== 'HEAD') ||
    pathname.length === 0 ||
    pathname.length > 2_048
  ) {
    return false;
  }
  const accept = readPreviewHeadlessRequestHeader(request, 'accept');
  if (
    !accept
      ?.split(',')
      .some((value) => value.split(';', 1)[0]?.trim().toLowerCase() === 'text/html')
  ) {
    return false;
  }
  const destination = readPreviewHeadlessRequestHeader(request, 'sec-fetch-dest');
  if (destination !== undefined && destination.toLowerCase() !== 'document') return false;
  const mode = readPreviewHeadlessRequestHeader(request, 'sec-fetch-mode');
  if (mode !== undefined && mode.toLowerCase() !== 'navigate') return false;
  const site = readPreviewHeadlessRequestHeader(request, 'sec-fetch-site');
  if (site !== undefined && site.toLowerCase() !== 'same-origin' && site.toLowerCase() !== 'none')
    return false;
  const purpose =
    readPreviewHeadlessRequestHeader(request, 'sec-purpose') ??
    readPreviewHeadlessRequestHeader(request, 'purpose');
  if (purpose?.toLowerCase().includes('prefetch') === true) return false;
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const segments = decodedPathname.split('/').filter(Boolean);
  return segments.length <= 64 && segments.every((segment) => !segment.includes('.'));
}

/** Reads one bounded Node request-header value without weakening multi-value checks. */
export function readPreviewHeadlessRequestHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(',') : value;
}

/** Binds the inherited dedicated loopback and returns validated actual coordinates for every consumer. */
export function listenOnLoopback(
  server: Server,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): Promise<PreviewLoopbackEndpoint> {
  return new Promise((resolve, reject) => {
    const host = resolvePreviewLoopbackHost(environment);
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      const address = server.address();
      if (
        address === null ||
        typeof address === 'string' ||
        !isPreviewLoopbackHost(address.address) ||
        !Number.isSafeInteger(address.port) ||
        address.port < 1 ||
        address.port > 65535
      ) {
        reject(new Error('Headless preview server did not expose an IPv4 loopback endpoint.'));
      } else resolve({ host: address.address, port: address.port });
    });
  });
}

/** Closes the loopback listener and all retained HTTP connections. */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (
        error === undefined ||
        (error as NodeJS.ErrnoException | undefined)?.code === 'ERR_SERVER_NOT_RUNNING'
      )
        resolve();
      else reject(error);
    });
    server.closeAllConnections();
  });
}
