const { parentPort } = require('node:worker_threads');
const { build } = require('esbuild');

if (parentPort === null) {
  throw new Error('Managed-child environment fixture requires a parent worker.');
}

parentPort.on('message', async (message) => {
  if (message?.type === 'shutdown') {
    parentPort.postMessage({ type: 'shutdown-complete' });
    parentPort.close();
    return;
  }
  if (message?.type !== 'compile') return;
  parentPort.postMessage({ id: message.id, type: 'started' });
  try {
    assertSanitizedEnvironment();
    const result = await build({
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      stdin: {
        contents: 'export default 42;',
        loader: 'js',
        sourcefile: '<managed-child-environment>',
      },
      write: false,
    });
    const javascript = result.outputFiles?.[0]?.contents;
    if (javascript === undefined) throw new Error('Fixture esbuild emitted no JavaScript.');
    parentPort.postMessage({
      bundle: {
        chunks: [],
        dependencies: [],
        diagnostics: [],
        javascript,
        watchDirectories: [],
      },
      id: message.id,
      type: 'success',
    });
  } catch (error) {
    parentPort.postMessage({
      error: {
        diagnostics: [],
        kind: 'compilation',
        message: error instanceof Error ? error.message : String(error),
        name: 'PreviewCompilationError',
      },
      id: message.id,
      type: 'failure',
    });
  }
});

function assertSanitizedEnvironment() {
  const unsafe = Object.keys(process.env).some(
    (name) =>
      name.startsWith('DYLD_') ||
      name === 'LD_PRELOAD' ||
      name === 'LD_AUDIT' ||
      name === 'LD_LIBRARY_PATH',
  );
  if (unsafe || process.env.PORT_MANAGER_HOOK !== '0') {
    throw new Error('Managed child inherited a denied loader environment variable.');
  }
  if (process.env.SAFE_SENTINEL !== 'preserved') {
    throw new Error('Managed child did not retain its safe environment sentinel.');
  }
}
