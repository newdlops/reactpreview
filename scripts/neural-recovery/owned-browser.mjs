/** Runs repository-generated tests in a new private Chromium process/profile with nonce-only CSP. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

/** Executes only the supplied owned script; closes its process on completion, timeout or failure. */
export async function runOwnedBrowser(script, resultName, timeoutMs = 180000) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(resultName))
    throw new Error('Expected an owned result identifier.');
  const executable = [
    process.env.CHROMIUM_PATH,
    '/opt/homebrew/bin/chromium',
    '/usr/bin/chromium',
  ].find((candidate) => typeof candidate === 'string' && existsSync(candidate));
  if (!executable) throw new Error('An isolated Chromium executable is required.');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const built = buildSync({
    absWorkingDir: root,
    entryPoints: ['src/adapters/node/previewManagedChildEnvironment.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const factory = { exports: {} };
  vm.runInNewContext(built.outputFiles[0].text, {
    module: factory,
    exports: factory.exports,
    require: createRequire(import.meta.url),
  });
  const temporary = await mkdtemp(join(tmpdir(), 'react-preview-owned-learning-'));
  const page = join(temporary, 'index.html');
  await writeFile(
    page,
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" ' +
      "content=\"default-src 'none'; script-src 'nonce-recovery-proof'\">" +
      '<title>Owned recovery experiment</title><div id="root"></div><script nonce="recovery-proof">' +
      script.replaceAll('</script', '<\\/script') +
      '</script>',
  );
  const browser = spawn(
    executable,
    [
      '--headless=new',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-sync',
      '--no-first-run',
      '--remote-debugging-pipe',
      '--user-data-dir=' + join(temporary, 'profile'),
      'about:blank',
    ],
    {
      env: factory.exports.createPreviewManagedChildEnvironment(process.env),
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    },
  );
  let buffer = '';
  let sequence = 0;
  let stderr = '';
  const pending = new Map();
  browser.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  /** Releases all bounded command waiters without leaving a browser test hanging. */
  const rejectPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  browser.on('error', rejectPending);
  browser.on('exit', () => rejectPending(new Error('Owned Chromium exited: ' + stderr)));
  browser.stdio[4].on('data', (chunk) => {
    buffer += chunk.toString();
    for (let boundary = buffer.indexOf('\0'); boundary >= 0; boundary = buffer.indexOf('\0')) {
      const encoded = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      if (!encoded) continue;
      const message = JSON.parse(encoded);
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    }
  });
  /** Uses only the newly spawned process's private pipe, never a personal browser connection. */
  const request = (method, params = {}, sessionId) => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(method + ' timed out'));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      browser.stdio[3].write(
        JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0',
      );
    });
  };
  try {
    const target = await request('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await request('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    await request('Page.enable', {}, sessionId);
    await request('Page.navigate', { url: pathToFileURL(page).href }, sessionId);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await request(
        'Runtime.evaluate',
        {
          expression: 'JSON.stringify(globalThis.' + resultName + ' ?? null)',
          returnByValue: true,
        },
        sessionId,
      );
      const result = JSON.parse(response.result.value);
      if (result !== null) {
        if (result.error) throw new Error('Owned browser experiment failed: ' + result.error);
        return { result, profileDirectory: temporary };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Owned browser experiment exceeded its time budget.');
  } finally {
    await request('Browser.close').catch(() => undefined);
    if (browser.exitCode === null) browser.kill('SIGTERM');
    rejectPending(new Error('Owned browser experiment completed.'));
  }
}
