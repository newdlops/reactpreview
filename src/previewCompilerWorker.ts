/**
 * Composes the standalone compiler worker around Node's parent message port.
 * Scheduling lives in the adapter; this entry owns the worker's shared native-engine lifetime.
 */
import { stop } from 'esbuild';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { EsbuildPreviewCompiler } from './adapters/esbuild/esbuildPreviewCompiler';
import { trustPreviewSystemCertificates } from './adapters/node/previewSystemCertificateTrust';
import type { PreviewCompilerWorkerBootstrap } from './adapters/worker/previewCompilerWorkerClient';
import { PreviewCompilerWorkerServer } from './adapters/worker/previewCompilerWorkerServer';
import { createPreviewSassWorkerTaskFactory } from './adapters/worker/previewSassWorkerClient';

if (parentPort === null) {
  throw new Error('React Preview compiler worker requires a parent worker-thread port.');
}

const workerPort = parentPort;
const bootstrap = readWorkerBootstrap(workerData);
// Package downloads in this thread do not see VS Code's main-thread certificate patching.
if (bootstrap.trustSystemCertificates !== false) trustPreviewSystemCertificates();
const compiler = new EsbuildPreviewCompiler({
  ...bootstrap,
  createSassTask: createPreviewSassWorkerTaskFactory(path.join(__dirname, 'previewSassWorker.js')),
});
let shutdownPromise: Promise<void> | undefined;
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
  {
    compile: (request, context) => compiler.compile(request, context),
    collectCompleteRouteInventory: (request, limits, signal, observer) =>
      compiler.collectCompleteRouteInventory(request, limits, signal, observer),
    shutdown: () => (shutdownPromise ??= compiler.shutdown().then(() => stop())),
  },
);
server.start();

/** Accepts absolute parent-owned storage paths and ignores malformed standalone worker data. */
function readWorkerBootstrap(value: unknown): PreviewCompilerWorkerBootstrap {
  if (typeof value !== 'object' || value === null) return Object.freeze({});
  const record = value as Readonly<Record<string, unknown>>;
  const adapterLearningRoot = normalizeAbsolutePath(record.adapterLearningRoot);
  const bundledNodeModulesPath = normalizeAbsolutePath(record.bundledNodeModulesPath);
  const managedDependencyStoreRoot = normalizeAbsolutePath(record.managedDependencyStoreRoot);
  return Object.freeze({
    ...(adapterLearningRoot === undefined ? {} : { adapterLearningRoot }),
    ...(bundledNodeModulesPath === undefined ? {} : { bundledNodeModulesPath }),
    ...(managedDependencyStoreRoot === undefined ? {} : { managedDependencyStoreRoot }),
    ...(record.trustSystemCertificates === false ? { trustSystemCertificates: false } : {}),
  });
}

/** Narrows structured-clone data to one normalized absolute filesystem path. */
function normalizeAbsolutePath(value: unknown): string | undefined {
  return typeof value === 'string' && path.isAbsolute(value) ? path.normalize(value) : undefined;
}
