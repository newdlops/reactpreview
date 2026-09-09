/** Measures one runtime gate lookup with a full retained model and mostly unrelated conditions. */
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const iterations = Number(process.argv[2] ?? 20);
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100) {
  throw new Error('Iterations must be an integer between 1 and 100.');
}
const factories = ['NeuralResidual', 'TargetReachability', 'TargetPathIdentity'];
const built = buildSync({
  stdin: {
    contents: factories
      .map(
        (name) =>
          `export { createPreviewInspector${name}RuntimeSource } from './src/adapters/esbuild/pageInspector/previewInspector${name}RuntimeSource';`,
      )
      .join('\n'),
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const factory = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module: factory, exports: factory.exports });
const source = factories
  .map((name) => factory.exports['createPreviewInspector' + name + 'RuntimeSource']())
  .join('\n');
const context = vm.createContext({});
vm.runInContext(
  `
  const previewEntryRevision = 7;
  const previewInspectorSession = { selectedExportName: 'Target', renderConditionOverrides: new Map(), renderConditions: new Map() };
  const initializePreviewInspectorConditionState = () => undefined;
  ${source}
  const descriptor = { inspector: { target: { sourcePath: '/app/Target.tsx', exportName: 'Target' } } };
  const candidate = { root: { exportName: 'Checkout', sourcePath: '/app/Checkout.tsx' },
    routeLocation: { pattern: '/checkout' }, renderPath: { steps: [
      { label: 'Target', sourcePath: '/app/Target.tsx' }, { label: 'Checkout', sourcePath: '/app/Checkout.tsx' } ] } };
  const state = { key: 'checkout:Target', rootName: 'Checkout', targetExportName: 'Target',
    targetSourcePath: '/app/Target.tsx', applicationPath: ['Checkout', 'Target'] };
  for (let index = 0; index < 126; index++) {
    const local = index >= 120;
    const id = local ? 'target-' + (index - 120) : 'sibling-' + index;
    previewInspectorSession.renderConditions.set(id, {
      id, expression: id, ownerName: local ? 'Target' : 'Other', sourcePath: local ? '/app/Target.tsx' : '/other/Page.tsx',
      reachabilityKey: state.key, reachabilityDiscoveryOrder: index, line: index + 1,
      effectiveEnabled: false, authoredEnabled: false, targetBranch: 'truthy',
    });
  }
  const model = createPreviewInspectorNeuralResidualModel();
  for (const key of PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS) {
    model.heads[key] = { evidence: 100, outputBias: 0.1, outputWeights: Array(16).fill(0), updates: 100 };
  }
  model.updates = 1000;
  for (let index = 0; index < 192; index++) {
    const family = PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS[index % 10];
    model.candidateOutcomes[family + ':' + index.toString(16).padStart(8, '0')] = {
      attempts: 3, consecutiveFailures: 0, evidence: 2.5, lastConfidence: 0.85,
      lastLabel: 1, rewardSum: 2.5, sequence: index + 1,
    };
  }
  model.outcomeSequence = 192;
  previewInspectorSession.neuralResidualModel = model;
  globalThis.run = () => {
    const selected = selectPreviewInspectorNextTargetGate(descriptor, candidate, state);
    return { id: selected?.condition.id, desired: selected?.desiredValue };
  };
  globalThis.countOperations = () => {
    const initialize = initializePreviewInspectorNeuralResidualModel;
    const infer = runPreviewInspectorNeuralResidualModel;
    const owners = readPreviewInspectorTargetOwnerSourceKeys;
    const counts = { validation: 0, inference: 0, ownerScans: 0 };
    initializePreviewInspectorNeuralResidualModel = (...args) => { counts.validation++; return initialize(...args); };
    runPreviewInspectorNeuralResidualModel = (...args) => { counts.inference++; return infer(...args); };
    readPreviewInspectorTargetOwnerSourceKeys = (...args) => { counts.ownerScans++; return owners(...args); };
    try { run(); return counts; } finally {
      initializePreviewInspectorNeuralResidualModel = initialize;
      runPreviewInspectorNeuralResidualModel = infer;
      readPreviewInspectorTargetOwnerSourceKeys = owners;
    }
  };
`,
  context,
);
for (let warmup = 0; warmup < 5; warmup++) context.run();
const durationsMs = [],
  cpuMs = [];
let selected;
for (let sample = 0; sample < 5; sample++) {
  const cpu = process.cpuUsage(),
    start = performance.now();
  for (let index = 0; index < iterations; index++) selected = context.run();
  durationsMs.push(performance.now() - start);
  const used = process.cpuUsage(cpu);
  cpuMs.push((used.user + used.system) / 1000);
}
/** Returns the middle sample without changing recorded sample order. */
function median(values) {
  return [...values].sort((a, b) => a - b)[2];
}
console.log(
  JSON.stringify(
    {
      iterations,
      conditions: 126,
      admissibleGates: 6,
      retainedOutcomes: 192,
      sourceHash: createHash('sha256').update(source).digest('hex'),
      selected,
      resultHash: createHash('sha256').update(JSON.stringify(selected)).digest('hex'),
      operations: context.countOperations(),
      durationsMs,
      medianMs: median(durationsMs),
      medianCpuMs: median(cpuMs),
    },
    null,
    2,
  ),
);
