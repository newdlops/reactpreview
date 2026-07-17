/**
 * Composes the standalone compiler worker around Node's parent message port.
 * Scheduling and compiler ownership live in the adapter module so this entry contains no policy.
 */
import { parentPort } from 'node:worker_threads';
import { PreviewCompilerWorkerServer } from './adapters/worker/previewCompilerWorkerServer';

if (parentPort === null) {
  throw new Error('React Preview compiler worker requires a parent worker-thread port.');
}

const workerPort = parentPort;
const server = new PreviewCompilerWorkerServer({
  close: () => {
    workerPort.close();
  },
  onMessage: (listener) => {
    workerPort.on('message', listener);
  },
  postMessage: (message, transferList = []) => {
    workerPort.postMessage(message, transferList);
  },
});
server.start();
