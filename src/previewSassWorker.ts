/** Preloads project Sass, compiles one explicitly requested live entry, then closes its port. */
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import {
  compilePreviewSass,
  loadProjectSassJavaScriptImplementation,
  type PreviewSassCompileInput,
} from './adapters/esbuild/previewSassCompiler';

if (parentPort === null) throw new Error('Sass task requires a parent worker-thread port.');
const port = parentPort;
const input = readInput(workerData);
const sass =
  input === undefined ? undefined : loadProjectSassJavaScriptImplementation(input.projectRoot);
port.once('message', (message: unknown) => {
  void compileRequestedEntry(message).finally(() => {
    port.close();
  });
});

/** Reads styles only after the parent reaches esbuild's load callback; failures trigger fallback. */
async function compileRequestedEntry(message: unknown): Promise<void> {
  try {
    if (
      input === undefined ||
      sass === undefined ||
      typeof message !== 'object' ||
      message === null ||
      !('type' in message) ||
      message.type !== 'compile'
    ) {
      port.postMessage({ unavailable: true });
      return;
    }
    const result = await compilePreviewSass(sass, input);
    port.postMessage({ css: result.css, loadedUrls: result.loadedUrls.map((url) => url.href) });
  } catch {
    port.postMessage({ unavailable: true });
  }
}

/** Accepts only absolute, parent-owned filesystem inputs with a Sass entry extension. */
function readInput(value: unknown): PreviewSassCompileInput | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  const { projectRoot, sourcePath, workspaceRoot } = record;
  if (
    [projectRoot, sourcePath, workspaceRoot].some(
      (value) => typeof value !== 'string' || !path.isAbsolute(value),
    ) ||
    typeof sourcePath !== 'string' ||
    !/\.s[ac]ss$/iu.test(sourcePath)
  )
    return undefined;
  return { projectRoot: projectRoot as string, sourcePath, workspaceRoot: workspaceRoot as string };
}
