/**
 * Composes the standalone compiler worker around Node's parent message port.
 * Scheduling and compiler ownership live in the adapter module so this entry contains no policy.
 */
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { EsbuildPreviewCompiler } from './adapters/esbuild/esbuildPreviewCompiler';
import type { PreviewCompilerWorkerBootstrap } from './adapters/worker/previewCompilerWorkerClient';
import { PreviewCompilerWorkerServer } from './adapters/worker/previewCompilerWorkerServer';

if (parentPort === null) {
  throw new Error('React Preview compiler worker requires a parent worker-thread port.');
}

const workerPort = parentPort;
const bootstrap = readWorkerBootstrap(workerData);
const server = new PreviewCompilerWorkerServer(
  {
    close: () => {
      workerPort.close();
    },
    onMessage: (listener) => {
      workerPort.on('message', listener);
    },
    postMessage: (message, transferList = []) => {
      workerPort.postMessage(message, transferList);
    },
  },
  new EsbuildPreviewCompiler(bootstrap),
);
server.start();

/** Accepts absolute parent-owned storage paths and ignores malformed standalone worker data. */
function readWorkerBootstrap(value: unknown): PreviewCompilerWorkerBootstrap {
  if (typeof value !== 'object' || value === null) return Object.freeze({});
  const record = value as Readonly<Record<string, unknown>>;
  const bundledNodeModulesPath = normalizeAbsolutePath(record.bundledNodeModulesPath);
  const managedDependencyStoreRoot = normalizeAbsolutePath(record.managedDependencyStoreRoot);
  return Object.freeze({
    ...(bundledNodeModulesPath === undefined ? {} : { bundledNodeModulesPath }),
    ...(managedDependencyStoreRoot === undefined ? {} : { managedDependencyStoreRoot }),
  });
}

/** Narrows structured-clone data to one normalized absolute filesystem path. */
function normalizeAbsolutePath(value: unknown): string | undefined {
  return typeof value === 'string' && path.isAbsolute(value) ? path.normalize(value) : undefined;
}
