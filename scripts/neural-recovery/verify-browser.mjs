/** Executes the packaged recovery runtime under strict CSP in an owned, isolated Chromium page. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { buildSync, transformSync } from 'esbuild';

const outputDirectory = process.argv[2];
if (!outputDirectory)
  throw new Error('Usage: node scripts/neural-recovery/verify-browser.mjs <report-directory>');
const root = fileURLToPath(new URL('../../', import.meta.url));
const executable = [
  process.env.CHROMIUM_PATH,
  '/opt/homebrew/bin/chromium',
  '/usr/bin/chromium',
].find((candidate) => typeof candidate === 'string' && existsSync(candidate));
if (!executable)
  throw new Error('An isolated Chromium executable is required for this browser proof.');
const built = buildSync({
  stdin: {
    contents: `export { createPreviewInspectorNeuralResidualRuntimeSource } from './src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
   export { createPreviewManagedChildEnvironment } from './src/adapters/node/previewManagedChildEnvironment';`,
    resolveDir: root,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const factory = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, {
  module: factory,
  exports: factory.exports,
  require: (await import('node:module')).createRequire(import.meta.url),
});
const source = factory.exports.createPreviewInspectorNeuralResidualRuntimeSource();
const probe = transformSync(
  `
  const violations = [];
  document.addEventListener('securitypolicyviolation', (event) => violations.push(event.violatedDirective));
  try {
    const previewEntryRevision = 1;
    const previewInspectorSession = {};
    ${source}
    const problem = { blockerKind: 'runtime-fallback', holeKind: 'rendered-collection-consumer-data',
      numbers: { callableCandidateCount: 2, requiredPathCount: 6 },
      tokens: ['compiler-call-result-candidate', 'role:collection-filter-predicate'] };
    const candidates = [
      { id: 'neutral-callable', deterministicRank: 0, numbers: { retainsData: 0 },
        tokens: ['strategy:neutral-call-result', 'role:collection-filter-predicate'] },
      { id: 'retain-generated-collection', deterministicRank: 1, numbers: { retainsData: 1 },
        tokens: ['strategy:data-retaining-call-result', 'role:collection-filter-predicate'] },
    ];
    const started = performance.now();
    const first = selectPreviewInspectorNeuralResidualCandidate(problem, candidates);
    const firstSelectionMs = performance.now() - started;
    const coldModel = serializePreviewInspectorNeuralResidualModel();
    const cacheSize = previewInspectorRecoveryPriorScores.size;
    trainPreviewInspectorNeuralResidualDecision(first.decision, 0, 1);
    const next = selectPreviewInspectorNeuralResidualCandidate(problem, candidates);
    globalThis.neuralSmoke = {
      first: first.candidateId, next: next.candidateId, prior: first.decision.priorVersion,
      coldScore: first.decision.score, coldEvidence: first.decision.headEvidence,
      coldUpdates: coldModel.updates, afterFailureUpdates: serializePreviewInspectorNeuralResidualModel().updates,
      nextHasPrior: next.decision.priorScore !== undefined, version: coldModel.version,
      firstSelectionMs, cacheSize, violations, resources: performance.getEntriesByType('resource').length,
    };
  } catch (error) { globalThis.neuralSmoke = { error: String(error) }; }
`,
  { minify: true, target: 'es2022' },
).code;
const temporary = await mkdtemp(join(tmpdir(), 'react-preview-neural-csp-'));
const page = join(temporary, 'index.html');
await writeFile(
  page,
  '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" ' +
    "content=\"default-src 'none'; script-src 'nonce-recovery-proof'\">" +
    '<title>Owned neural runtime proof</title><script nonce="recovery-proof">' +
    probe.replaceAll('</script', '<\\/script') +
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
    '--user-data-dir=' + join(temporary, 'chromium-profile'),
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

/** Rejects outstanding commands if the owned browser cannot finish the proof. */
function rejectPending(error) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
}
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

/** Sends one time-bounded command only through this newly spawned browser's private pipe. */
function request(method, params = {}, sessionId) {
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
}

try {
  const target = await request('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await request('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  await request('Page.enable', {}, sessionId);
  await request('Page.navigate', { url: pathToFileURL(page).href }, sessionId);
  let result;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request(
      'Runtime.evaluate',
      {
        expression: 'JSON.stringify(globalThis.neuralSmoke ?? null)',
        returnByValue: true,
      },
      sessionId,
    );
    result = JSON.parse(response.result.value);
    if (result !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(result, 'The nonce-authorized browser module did not execute.');
  assert.equal(result.error, undefined);
  assert.equal(result.first, 'retain-generated-collection');
  assert.equal(result.next, 'neutral-callable');
  assert.equal(result.coldScore, 0.5);
  assert.equal(result.coldEvidence, 0);
  assert.equal(result.coldUpdates, 0);
  assert.equal(result.afterFailureUpdates, 1);
  assert.equal(result.nextHasPrior, false);
  assert.equal(result.version, 4);
  assert.equal(result.resources, 0);
  assert.deepEqual(result.violations, []);
  const report = {
    ...result,
    isolated: true,
    csp: "default-src 'none'; script-src nonce-only",
    profileDirectory: temporary,
    visualInspection: false,
  };
  await writeFile(
    resolve(outputDirectory, 'browser-validation.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await request('Browser.close').catch(() => undefined);
  if (browser.exitCode === null) browser.kill('SIGTERM');
  rejectPending(new Error('Browser proof completed.'));
}
